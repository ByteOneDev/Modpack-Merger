import { ZipStream, isPrecompressed, toU8, type ZipSink } from "./zip";
import { bytesEqual } from "./hash";
import { latestLoaderVersion, MRPACK_LOADER_KEY } from "./loaderversions";
import { applyDecision, type OverrideSide, type PackFiles } from "./merge/overrides";
import { estimateRam } from "./merge/ram";
import { getProviderConfig } from "./providers/config";
import { CONTENT_INFO, SCHEMATIC_MODS, type ContentKind } from "./content";
import { buildSummary, type PackSummary, type SummaryItem } from "./summary";
import type {
  MergeTarget,
  ModResolution,
  OverrideDecision,
  RamEstimate,
} from "./types";

export type ExportFormat = "mrpack" | "curseforge";

/**
 * Dossier de destination d'un contenu.
 *
 * Les schematiques sont le seul cas ou le dossier depend du pack lui-meme :
 * Litematica lit schematics/, WorldEdit config/worldedit/schematics/. Poser
 * un fichier au mauvais endroit revient a ne pas le livrer.
 */
export function folderFor(kind: ContentKind, schematicFolder = "schematics"): string {
  return kind === "schematic" ? schematicFolder : CONTENT_INFO[kind].folder;
}

/** Dossier a schematiques impose par les mods presents dans le pack. */
export function detectSchematicFolder(resolutions: ModResolution[]): string {
  for (const r of resolutions) {
    if (r.status !== "ok" && r.status !== "substituted") continue;
    const hit =
      SCHEMATIC_MODS[(r.project?.slug ?? "").toLowerCase()] ??
      SCHEMATIC_MODS[(r.source?.slug ?? "").toLowerCase()];
    if (hit) return hit.folder;
  }
  return "schematics";
}

export interface BuildOptions {
  target: MergeTarget;
  resolutions: ModResolution[];
  /** un jeu de fichiers par pack, dans l'ordre de priorite decroissante */
  packFiles: PackFiles[];
  decisions: Record<string, OverrideDecision>;
  format: ExportFormat;
  bundleJars: boolean;
  concurrency?: number;
  ram?: RamEstimate;
  /**
   * Fichiers recuperes a la main par l'utilisateur, indexes par cle de
   * resolution. Ils court-circuitent le telechargement automatique.
   */
  manualFiles?: Map<string, Uint8Array>;
  /**
   * Destination sur disque. Quand elle est fournie, l'archive n'est jamais
   * detenue en entier : indispensable au-dela de ~2 Go, ou le stockage de
   * Blobs du navigateur atteint lui aussi ses limites.
   */
  sink?: ZipSink;
  onProgress?: (step: string, done: number, total: number) => void;
}

export interface BuildReport {
  fileName: string;
  modsIncluded: number;
  modsLinked: number;
  modsBundled: number;
  modsFailed: { name: string; reason: string; key: string; pageUrl?: string }[];
  /** nombre de fichiers repris depuis un telechargement manuel */
  modsFromManual: number;
  overridesWritten: number;
  overrideConflictsResolved: number;
  totalBytes: number;
  warnings: string[];
}

/** Domaines acceptes par les lanceurs pour les liens d'un .mrpack. */
const MRPACK_ALLOWED_HOSTS = [
  "cdn.modrinth.com",
  "github.com",
  "raw.githubusercontent.com",
  "gitlab.com",
];

function isMrpackAllowed(url: string): boolean {
  try {
    return MRPACK_ALLOWED_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

const MAX_JAR_BYTES = 400 * 1024 * 1024;

/**
 * Hotes autorises pour le telechargement d'un jar.
 *
 * Les URLs viennent des reponses d'API, donc d'une source deja filtree, mais
 * le relais CurseForge est configure par l'utilisateur : un relais hostile ou
 * compromis pourrait renvoyer n'importe quelle adresse. Cette liste evite
 * qu'une reponse d'API declenche une requete arbitraire — et elle devient
 * indispensable des que le telechargement passe par un proxy serveur, ou ce
 * serait une SSRF.
 */
export const DOWNLOAD_HOSTS = new Set([
  "cdn.modrinth.com",
  "edge.forgecdn.net",
  "mediafilez.forgecdn.net",
  "media.forgecdn.net",
  "github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "gitlab.com",
]);

export function isAllowedDownload(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && DOWNLOAD_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

async function download(url: string): Promise<Uint8Array | null> {
  if (!isAllowedDownload(url)) return null;

  // Quand l'hebergement fournit un relais, on passe par lui : beaucoup de CDN
  // de mods n'envoient pas d'en-tetes CORS et refusent donc les requetes
  // venant directement d'une page web.
  const proxy = getProviderConfig().downloadProxyUrl;
  const target = proxy ? `${proxy}?url=${encodeURIComponent(url)}` : url;

  try {
    const res = await fetch(target, { signal: AbortSignal.timeout(120_000), redirect: "follow" });
    if (!res.ok) return null;
    // Sans relais, une redirection peut sortir de la liste blanche : on
    // revalide l'arrivee. Avec relais, c'est lui qui a deja verifie chaque saut.
    if (!proxy && res.url && !isAllowedDownload(res.url)) return null;
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > MAX_JAR_BYTES) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    // content-length peut mentir ou manquer : on verifie la taille reelle.
    if (buf.length > MAX_JAR_BYTES) return null;
    return buf;
  } catch {
    return null;
  }
}

interface BundleItem {
  key: string;
  name: string;
  /** destination dans l'archive */
  path: string;
  url: string;
  /** page ou recuperer le fichier a la main si le telechargement echoue */
  pageUrl?: string;
  /** message a afficher si le telechargement echoue */
  failure: string;
}

/**
 * Telecharge et remet chaque fichier au fur et a mesure.
 *
 * `onReady` est synchrone et appele depuis la continuation d'un await : il ne
 * peut donc pas s'entrelacer avec un autre, ce qui garantit que les entrees
 * arrivent une par une dans l'archive.
 */
async function downloadInto(
  items: BundleItem[],
  concurrency: number,
  onReady: (item: BundleItem, data: Uint8Array | null) => void,
  onProgress?: (done: number, total: number) => void,
  drain?: () => Promise<void>,
): Promise<void> {
  let cursor = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      const item = items[i];
      const data = await download(item.url);
      onReady(item, data);
      await drain?.();
      onProgress?.(++done, items.length);
    }
  });
  await Promise.all(workers);
}

export async function buildPack(opts: BuildOptions): Promise<{
  /** null quand l'archive a ete ecrite directement dans un fichier */
  blob: Blob | null;
  report: BuildReport;
}> {
  const { target, format, bundleJars } = opts;
  const warnings: string[] = [];
  const failed: BuildReport["modsFailed"] = [];

  // Archive ecrite au fil de l'eau. Un pack complet de plusieurs centaines de
  // mods pese plus que ce qu'un seul tableau d'octets peut contenir : tout
  // assembler en memoire avant d'ecrire echouait sur "Array buffer allocation
  // failed" des que le total approchait le Go.
  const zip = new ZipStream(opts.sink);
  const write = (path: string, data: Uint8Array) =>
    zip.add(path, data, !isPrecompressed(path));

  const kept = opts.resolutions.filter(
    (r) => (r.status === "ok" || r.status === "substituted") && r.picked,
  );

  /* ---------------- fichiers d'instance ---------------- */

  // CurseForge ne connait pas les overrides client/serveur : on les replie
  // sur overrides/ plutot que de les perdre en silence.
  const outPath = (p: string) =>
    format === "mrpack" ? p : p.replace(/^(client|server)-overrides\//, "overrides/");

  const byPath = new Map<string, OverrideSide[]>();
  for (const pack of opts.packFiles) {
    for (const [path, data] of Object.entries(pack.files)) {
      const list = byPath.get(path) ?? [];
      list.push({ packId: pack.packId, label: pack.label, data });
      byPath.set(path, list);
    }
  }

  let overridesWritten = 0;
  let conflictsResolved = 0;

  for (const [path, sides] of byPath) {
    if (sides.length === 1 || sides.every((s) => bytesEqual(s.data, sides[0].data))) {
      write(outPath(path), sides[0].data);
      overridesWritten++;
      continue;
    }
    const decision = opts.decisions[path] ?? sides[0].packId;
    for (const file of applyDecision(path, sides, decision)) {
      write(outPath(file.path), file.data);
      overridesWritten++;
    }
    conflictsResolved++;
  }

  if (
    format === "curseforge" &&
    [...byPath.keys()].some((p) => /^(client|server)-overrides\//.test(p))
  ) {
    warnings.push(
      "Des fichiers client-only ou server-only ont ete replies dans overrides/ : " +
        "le format CurseForge ne distingue pas les deux cotes.",
    );
  }

  /* ---------------- mods ---------------- */

  const schematicFolder = detectSchematicFolder(opts.resolutions);
  let linked = 0;
  let bundled = 0;
  let fromManual = 0;
  const toBundle: BundleItem[] = [];
  const indexFiles: unknown[] = [];
  const cfFiles: { projectID: number; fileID: number; required: boolean }[] = [];

  for (const r of kept) {
    const v = r.picked!;
    const nativeToFormat =
      format === "mrpack"
        ? v.provider === "modrinth" && v.downloadUrl && isMrpackAllowed(v.downloadUrl)
        : v.provider === "curseforge";

    if (!bundleJars && nativeToFormat) {
      if (format === "mrpack") {
        indexFiles.push({
          path: `${folderFor(r.kind, schematicFolder)}/${v.fileName}`,
          hashes: { sha1: v.hashes.sha1 ?? "", sha512: v.hashes.sha512 ?? "" },
          env: {
            client: envValue(r.project?.clientSide),
            server: envValue(r.project?.serverSide),
          },
          downloads: [v.downloadUrl!],
          fileSize: v.fileSize,
        });
      } else {
        cfFiles.push({
          projectID: Number(v.projectId),
          fileID: Number(v.versionId),
          required: true,
        });
      }
      linked++;
      continue;
    }

    // Un fichier depose a la main l'emporte : c'est le seul recours pour les
    // mods dont l'auteur a coupe la distribution par des tiers.
    const manual = opts.manualFiles?.get(r.key);
    if (manual) {
      write(`overrides/${folderFor(r.kind, schematicFolder)}/${v.fileName}`, manual);
      bundled++;
      fromManual++;
      continue;
    }

    if (v.downloadUrl && isAllowedDownload(v.downloadUrl)) {
      toBundle.push({
        key: r.key,
        name: r.name,
        path: `overrides/${folderFor(r.kind, schematicFolder)}/${v.fileName}`,
        url: v.downloadUrl,
        pageUrl: v.pageUrl ?? r.project?.url,
        failure:
          "telechargement echoue (le navigateur peut aussi l'avoir bloque pour cause de CORS)",
      });
    } else {
      failed.push({
        key: r.key,
        name: r.name,
        pageUrl: v.pageUrl ?? r.project?.url,
        reason: v.downloadUrl
          ? "lien de telechargement refuse : hote non autorise"
          : "distribution tierce desactivee par l'auteur : a recuperer a la main",
      });
    }
  }

  if (toBundle.length) {
    opts.onProgress?.("Telechargement des mods", 0, toBundle.length);
    // Chaque jar part dans l'archive des son arrivee, puis est relache : on
    // ne detient jamais plus de `concurrency` fichiers a la fois.
    await downloadInto(
      toBundle,
      opts.concurrency ?? 5,
      (item, data) => {
        if (!data) {
          failed.push({
            key: item.key,
            name: item.name,
            pageUrl: item.pageUrl,
            reason: item.failure,
          });
          return;
        }
        write(item.path, data);
        bundled++;
      },
      (done, total) => opts.onProgress?.("Telechargement des mods", done, total),
      () => zip.drain(),
    );
  }

  /* ---------------- manifeste ---------------- */

  opts.onProgress?.("Generation de l'archive", 0, 1);

  const loaderVersion = (await latestLoaderVersion(target.loader, target.minecraft)) ?? "";
  if (!loaderVersion) {
    warnings.push(
      `Version de ${target.loader} introuvable automatiquement : a renseigner dans le lanceur.`,
    );
  }

  const safeName =
    target.name
      .replace(/[^a-zA-Z0-9 _.+-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/ /g, "-") || "modpack";

  let fileName: string;

  if (format === "mrpack") {
    const dependencies: Record<string, string> = { minecraft: target.minecraft };
    if (loaderVersion) dependencies[MRPACK_LOADER_KEY[target.loader]] = loaderVersion;

    write("modrinth.index.json", toU8(
      JSON.stringify(
        {
          formatVersion: 1,
          game: "minecraft",
          versionId: target.version,
          name: target.name,
          summary: `Fusion generee — ${target.loader} ${target.minecraft}`,
          files: indexFiles,
          dependencies,
        },
        null,
        2,
      ),
    ));
    fileName = `${safeName}-${target.version}.mrpack`;
  } else {
    write("manifest.json", toU8(
      JSON.stringify(
        {
          minecraft: {
            version: target.minecraft,
            modLoaders: [{ id: `${target.loader}-${loaderVersion}`, primary: true }],
          },
          manifestType: "minecraftModpack",
          manifestVersion: 1,
          name: target.name,
          version: target.version,
          author: target.author,
          files: cfFiles,
          overrides: "overrides",
        },
        null,
        2,
      ),
    ));
    write("modlist.html", toU8(buildModlistHtml(kept, target)));
    if (!cfFiles.length && bundled > 0) {
      warnings.push(
        "Aucun mod n'a pu etre reference par son identifiant CurseForge : ils sont tous " +
          "embarques dans overrides/mods/. Le pack s'installe, mais sans mises a jour " +
          "automatiques par le lanceur.",
      );
    }
    fileName = `${safeName}-${target.version}.zip`;
  }

  const ram =
    opts.ram ?? estimateRam(opts.resolutions, target.minecraft);

  write(
    "RAPPORT-DE-FUSION.md",
    toU8(
      buildMarkdownReport(opts.resolutions, target, ram, {
        linked,
        bundled,
        failed,
        conflictsResolved,
        packs: opts.packFiles.map((p) => p.label),
      }),
    ),
  );

  let blob: Blob | null;
  try {
    blob = await zip.finish();
  } catch (err) {
    // Un fichier a moitie ecrit ressemble a une archive valide : mieux vaut
    // l'effacer que de laisser croire que l'export a reussi.
    await zip.abort();
    throw err;
  }
  const totalBytes = blob ? blob.size : zip.bytesWritten;

  return {
    blob,
    report: {
      fileName,
      modsIncluded: linked + bundled,
      modsLinked: linked,
      modsBundled: bundled,
      modsFromManual: fromManual,
      modsFailed: failed,
      overridesWritten,
      overrideConflictsResolved: conflictsResolved,
      totalBytes,
      warnings,
    },
  };
}

function envValue(v: string | undefined): string {
  return v === "unsupported" || v === "optional" || v === "required" ? v : "required";
}

function buildModlistHtml(kept: ModResolution[], target: MergeTarget): string {
  const rows = kept
    .map(
      (r) =>
        `<li><a href="${r.project?.url ?? "#"}">${escapeHtml(r.name)}</a> — ${escapeHtml(r.picked?.versionNumber ?? "")}</li>`,
    )
    .join("\n");
  return `<html><head><meta charset="utf-8"><title>${escapeHtml(target.name)}</title></head><body><h1>${escapeHtml(target.name)}</h1><ul>\n${rows}\n</ul></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

/** Inventaire par type de contenu, puis repartition client / serveur. */
function contentSections(sum: PackSummary): string[] {
  const line = (i: SummaryItem) =>
    `- **${i.name}** — ${i.versionNumber} · ${i.provider}` +
    (i.origin === "dependency" ? " _(dépendance)_" : "") +
    (i.origin === "manual" ? " _(ajouté à la main)_" : "") +
    (i.unstable ? " ⚠️ non stable" : "") +
    (i.manualOnly ? " 🔒 à récupérer à la main" : "") +
    (i.requires.length ? `\n  - exige : ${i.requires.join(", ")}` : "");

  const out: string[] = ["## Contenu du pack", ""];
  for (const g of sum.groups) {
    out.push(
      `### ${g.label} (${g.items.length})`,
      "",
      `_${g.hint}_`,
      "",
      ...g.items.map(line),
      "",
    );
  }

  out.push(
    "## Répartition client / serveur",
    "",
    `- **Client uniquement (${sum.clientOnly.length})** : ` +
      (sum.clientOnly.map((i) => i.name).join(", ") || "aucun"),
    "",
    `- **Serveur uniquement (${sum.serverOnly.length})** : ` +
      (sum.serverOnly.map((i) => i.name).join(", ") || "aucun"),
    "",
    `- **Les deux côtés (${sum.shared.length})**`,
    "",
    "Pour un serveur dédié, n'installer que « les deux côtés » et « serveur " +
      "uniquement » : le reste est inutile et consomme de la mémoire pour rien.",
    "",
  );

  if (sum.manualOnly.length) {
    out.push(
      `## À récupérer à la main (${sum.manualOnly.length})`,
      "",
      "Leur auteur interdit la distribution par des tiers. Ces fichiers se " +
        "téléchargent depuis leur page, puis se déposent dans le dossier indiqué.",
      "",
      ...sum.manualOnly.map(
        (i) => `- **${i.name}** ${i.versionNumber} → \`${CONTENT_INFO[i.kind].folder}/\`` +
          (i.url ? ` — ${i.url}` : ""),
      ),
      "",
    );
  }

  return out;
}

function buildMarkdownReport(
  resolutions: ModResolution[],
  target: MergeTarget,
  ram: RamEstimate,
  stats: {
    linked: number;
    bundled: number;
    failed: { name: string; reason: string }[];
    conflictsResolved: number;
    packs: string[];
  },
): string {
  const by = (s: ModResolution["status"]) => resolutions.filter((r) => r.status === s);
  const section = (
    title: string,
    rows: ModResolution[],
    fmt: (r: ModResolution) => string,
  ) => (rows.length ? `\n## ${title} (${rows.length})\n\n${rows.map(fmt).join("\n")}\n` : "");

  return [
    `# Rapport de fusion — ${target.name}`,
    "",
    `- Cible : **${target.loader} ${target.minecraft}**`,
    `- Version du pack : ${target.version}`,
    `- Packs fusionnes : ${stats.packs.join(", ")}`,
    `- Genere le ${new Date().toISOString().slice(0, 10)}`,
    `- Mods lies : ${stats.linked} · mods embarques : ${stats.bundled}`,
    `- Conflits de configuration arbitres : ${stats.conflictsResolved}`,
    "",
    ...contentSections(buildSummary(resolutions)),
    "## Memoire recommandee",
    "",
    `- **Client : ${ram.clientGb} Go** (minimum fonctionnel : ${ram.minimumGb} Go)`,
    `- **Serveur dedie : ${ram.serverGb} Go**`,
    "",
    "Detail du calcul :",
    "",
    ...ram.breakdown.map((b) => `- ${b.label} : ${b.gb >= 0 ? "+" : ""}${b.gb} Go — ${b.detail}`),
    "",
    "Arguments JVM conseilles :",
    "",
    "```",
    ram.jvmArgs,
    "```",
    "",
    ...ram.notes.map((n) => `> ${n}`),
    section(
      "Mods retenus",
      by("ok"),
      (r) =>
        `- **${r.name}** — ${r.picked?.versionNumber ?? "?"}${r.unstable ? " ⚠️ version non stable" : ""}${r.mergedFrom ? ` _(packs ${r.mergedFrom.join(", ")})_` : ""}`,
    ),
    section("Mods remplaces", by("substituted"), (r) => `- **${r.name}** — ${r.reason}`),
    section("Mods ecartes", by("excluded"), (r) => `- **${r.name}** — ${r.reason}`),
    section("Doublons fusionnes", by("duplicate"), (r) => `- **${r.name}** — ${r.reason}`),
    section("Mods introuvables", by("missing"), (r) => `- **${r.name}** — ${r.reason}`),
    stats.failed.length
      ? `\n## Jars non embarques (${stats.failed.length})\n\n${stats.failed
          .map((f) => `- **${f.name}** — ${f.reason}`)
          .join("\n")}\n\nCes mods sont a telecharger a la main depuis leur page.\n`
      : "",
    "",
  ].join("\n");
}
