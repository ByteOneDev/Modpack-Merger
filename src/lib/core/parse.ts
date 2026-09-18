import { readZip, readJson, type ZipEntries } from "./zip";
import { sha1, curseforgeFingerprint } from "./hash";
import { readJarMeta, nameFromFileName } from "./jarmeta";
import { modrinth, curseforge } from "./providers";
import { kindFromPath, CONTENT_INFO, type ContentKind } from "./content";
import type {
  EnvSupport,
  LoaderId,
  PackFormat,
  PackMod,
  ParsedPack,
} from "./types";

interface MrIndex {
  formatVersion: number;
  game: string;
  versionId?: string;
  name: string;
  summary?: string;
  files: {
    path: string;
    hashes: { sha1?: string; sha512?: string };
    env?: { client?: EnvSupport; server?: EnvSupport };
    downloads: string[];
    fileSize?: number;
  }[];
  dependencies: Record<string, string>;
}

interface CfManifest {
  minecraft: { version: string; modLoaders: { id: string; primary?: boolean }[] };
  manifestType?: string;
  name: string;
  version?: string;
  author?: string;
  files: { projectID: number; fileID: number; required?: boolean }[];
  overrides?: string;
}

export function detectFormat(entries: ZipEntries): PackFormat {
  if (entries["modrinth.index.json"]) return "mrpack";
  if (entries["manifest.json"]) return "curseforge";
  return "raw";
}

function loaderFromMrDependencies(deps: Record<string, string>) {
  const map: Record<string, LoaderId> = {
    "fabric-loader": "fabric",
    "quilt-loader": "quilt",
    forge: "forge",
    neoforge: "neoforge",
  };
  for (const [k, loader] of Object.entries(map)) {
    if (deps[k]) return { loader, loaderVersion: deps[k], minecraft: deps.minecraft };
  }
  return { minecraft: deps.minecraft };
}

function loaderFromCfManifest(m: CfManifest) {
  const primary = m.minecraft.modLoaders.find((l) => l.primary) ?? m.minecraft.modLoaders[0];
  if (!primary) return {};
  const [rawName, ...rest] = primary.id.split("-");
  const name = rawName.toLowerCase();
  const loader = (["fabric", "forge", "neoforge", "quilt"] as const).find((l) => l === name);
  return { loader, loaderVersion: rest.join("-") || undefined };
}

/**
 * Type de contenu d'une entree de manifeste. Un .mrpack declare ses resource
 * packs et shaders au meme titre que ses mods, dans des dossiers differents.
 */
function classifyEntry(p: string): ContentKind | "override" {
  return kindFromPath(p) ?? (p.startsWith("mods/") ? "mod" : "override");
}

function modrinthIdsFromUrl(url: string | undefined) {
  if (!url) return {};
  const m = /cdn\.modrinth\.com\/data\/([^/]+)\/versions\/([^/]+)\//.exec(url);
  return m ? { projectId: m[1], versionId: m[2] } : {};
}

let counter = 0;
const nextKey = (prefix: string) => `${prefix}-${(counter++).toString(36)}`;

/** Dossiers qu'on trouve a la racine d'une instance Minecraft. */
const INSTANCE_DIRS = [
  "mods/", "config/", "resourcepacks/", "shaderpacks/", "datapacks/",
  "defaultconfigs/", "kubejs/", "scripts/", "schematics/", "saves/", "journeymap/",
];

/**
 * Racine commune d'une archive brute ("MonPack/mods/x.jar" -> "MonPack/").
 *
 * Reperee sur les dossiers d'instance et non sur les seuls jars : beaucoup
 * d'archives partagees ne contiennent que des configurations, et il faut
 * quand meme retirer leur dossier englobant, sinon tout atterrit une fois
 * de trop imbrique.
 */
function commonPrefix(paths: string[]): string {
  if (!paths.length) return "";
  const candidates = new Set<string>();
  for (const p of paths) {
    for (const dir of INSTANCE_DIRS) {
      const i = p.indexOf(dir);
      if (i > 0 && (i === 0 || p[i - 1] === "/")) candidates.add(p.slice(0, i));
    }
  }
  // Le prefixe le plus court qui couvre toute l'archive : un prefixe plus
  // long retirerait un dossier qui fait partie du contenu.
  return (
    [...candidates]
      .sort((a, b) => a.length - b.length)
      .find((c) => paths.every((p) => p.startsWith(c))) ?? ""
  );
}

export interface ParseOptions {
  packId: string;
  label: string;
}

export async function parsePack(
  buf: Uint8Array,
  fileName: string,
  opts: ParseOptions,
): Promise<ParsedPack> {
  const entries = readZip(buf);
  const format = detectFormat(entries);
  const warnings: string[] = [];

  const pack: ParsedPack = {
    id: opts.packId,
    label: opts.label,
    format,
    name: fileName.replace(/\.(zip|mrpack)$/i, ""),
    mods: [],
    overridePaths: [],
    extraDownloads: [],
    warnings,
    fileName,
    fileSize: buf.length,
  };

  if (format === "mrpack") await parseMrpack(entries, pack, warnings);
  else if (format === "curseforge") await parseCurseforge(entries, pack, warnings);
  else await parseRaw(entries, pack, warnings);

  // La racine se lit sur l'archive complete : les relectures suivantes
  // sautent les jars pour economiser la memoire et ne pourraient plus la
  // deduire.
  pack.rootPrefix = format === "raw" ? commonPrefix(Object.keys(entries)) : "";
  pack.overridePaths = Object.keys(extractOverrides(entries, pack));

  if (!pack.loader) {
    warnings.push("Mod loader non detecte : il sera deduit des mods eux-memes.");
  }
  if (!pack.mods.length) warnings.push("Aucun mod trouve dans cette archive.");

  return pack;
}

async function parseMrpack(entries: ZipEntries, pack: ParsedPack, warnings: string[]) {
  const index = readJson<MrIndex>(entries, "modrinth.index.json");
  if (!index) {
    warnings.push("modrinth.index.json illisible, lecture en mode brut.");
    return parseRaw(entries, pack, warnings);
  }

  pack.name = index.name || pack.name;
  pack.version = index.versionId;
  pack.summary = index.summary;
  Object.assign(pack, loaderFromMrDependencies(index.dependencies ?? {}));

  for (const f of index.files) {
    const entry = classifyEntry(f.path);
    const { projectId, versionId } = modrinthIdsFromUrl(f.downloads?.[0]);
    const fileName = f.path.split("/").pop() ?? f.path;

    const mod: PackMod = {
      key: nextKey(pack.label),
      name: nameFromFileName(fileName),
      kind: entry === "override" ? "mod" : entry,
      provider: projectId ? "modrinth" : "unknown",
      projectId,
      fileId: versionId,
      path: f.path,
      fileName,
      fileSize: f.fileSize,
      hashes: { sha1: f.hashes?.sha1 },
      downloads: f.downloads ?? [],
      env: { client: f.env?.client ?? "unknown", server: f.env?.server ?? "unknown" },
      required: true,
      from: { kind: "pack", packId: pack.id },
    };

    // Les resource packs, shaders et datapacks du manifeste sont du contenu a
    // part entiere : ils doivent etre resolus et exportes comme les mods.
    if (entry === "override") pack.extraDownloads.push(mod);
    else pack.mods.push(mod);
  }

  await enrichModrinth(pack.mods);
}

async function parseCurseforge(entries: ZipEntries, pack: ParsedPack, warnings: string[]) {
  const manifest = readJson<CfManifest>(entries, "manifest.json");
  if (!manifest) {
    warnings.push("manifest.json illisible, lecture en mode brut.");
    return parseRaw(entries, pack, warnings);
  }

  pack.name = manifest.name || pack.name;
  pack.version = manifest.version;
  pack.author = manifest.author;
  pack.minecraft = manifest.minecraft?.version;
  Object.assign(pack, loaderFromCfManifest(manifest));

  const hasProxy = curseforge.available();
  if (!hasProxy) {
    warnings.push(
      "Pack CurseForge : sans proxy configure, ses mods ne sont identifies que par " +
        "numero de projet. Renseigne un proxy dans les reglages pour recuperer noms et versions.",
    );
  }

  const files = hasProxy
    ? await curseforge.getFiles(manifest.files.map((f) => String(f.fileID)))
    : [];
  const byFileId = new Map(files.map((v) => [v.versionId, v]));

  for (const f of manifest.files) {
    const v = byFileId.get(String(f.fileID));
    const cfName = v?.fileName ?? `${f.projectID}-${f.fileID}.jar`;
    const cfKind: ContentKind = cfName.toLowerCase().endsWith(".jar") ? "mod" : "resourcepack";
    pack.mods.push({
      key: nextKey(pack.label),
      name: v ? nameFromFileName(v.fileName) : `Projet CurseForge ${f.projectID}`,
      kind: cfKind,
      provider: "curseforge",
      projectId: String(f.projectID),
      fileId: String(f.fileID),
      versionNumber: v?.versionNumber,
      path: `${CONTENT_INFO[cfKind].folder}/${cfName}`,
      fileName: v?.fileName ?? `${f.projectID}-${f.fileID}.jar`,
      fileSize: v?.fileSize,
      hashes: { sha1: v?.hashes.sha1 },
      downloads: v?.downloadUrl ? [v.downloadUrl] : [],
      env: { client: "unknown", server: "unknown" },
      required: f.required !== false,
      from: { kind: "pack", packId: pack.id },
    });
  }

  if (hasProxy) await enrichCurseforge(pack.mods);
}

async function parseRaw(entries: ZipEntries, pack: ParsedPack, warnings: string[]) {
  const jarPaths = Object.keys(entries).filter((p) => /\.jar$/i.test(p));
  if (!jarPaths.length) {
    warnings.push("Aucun .jar trouve : archive ignoree.");
    return;
  }

  const prefix = commonPrefix(Object.keys(entries));
  const sha1s: string[] = [];
  const fingerprints: number[] = [];
  const staged: { mod: PackMod; fp: number }[] = [];

  for (const p of jarPaths) {
    const data = entries[p];
    const rel = p.slice(prefix.length);
    const fileName = p.split("/").pop()!;
    const h1 = sha1(data);
    const fp = curseforgeFingerprint(data);
    const meta = readJarMeta(data);

    sha1s.push(h1);
    fingerprints.push(fp);
    staged.push({
      mod: {
        key: nextKey(pack.label),
        name: meta?.name ?? nameFromFileName(fileName),
        kind: "mod",
        provider: "unknown",
        versionNumber: meta?.version,
        path: rel.startsWith("mods/") ? rel : `mods/${fileName}`,
        fileName,
        fileSize: data.length,
        hashes: { sha1: h1, murmur2: String(fp) },
        downloads: [],
        env: { client: "unknown", server: "unknown" },
        modId: meta?.modId,
        required: true,
        from: { kind: "pack", packId: pack.id },
      },
      fp,
    });
  }

  const [mrHits, cfHits] = await Promise.all([
    modrinth.lookupByHashes(sha1s).catch(() => new Map()),
    curseforge.lookupByFingerprints(fingerprints).catch(() => new Map()),
  ]);

  let identified = 0;
  for (const { mod, fp } of staged) {
    const hit = (mod.hashes.sha1 ? mrHits.get(mod.hashes.sha1) : undefined) ?? cfHits.get(fp);
    if (hit) {
      identified++;
      mod.provider = hit.provider;
      mod.projectId = hit.projectId;
      mod.fileId = hit.versionId;
      mod.versionNumber = hit.versionNumber;
      if (!pack.loader && hit.loaders.length) pack.loader = hit.loaders[0] as LoaderId;
      if (!pack.minecraft && hit.gameVersions.length) pack.minecraft = hit.gameVersions[0];
    }
    pack.mods.push(mod);
  }

  await enrichModrinth(pack.mods);

  const unknown = pack.mods.length - identified;
  if (unknown > 0) {
    warnings.push(
      `${unknown} mod(s) sur ${pack.mods.length} non identifies par leur empreinte ` +
        "(jars modifies ou non publies). Ils seront copies tels quels.",
    );
  }
}

/**
 * Fichiers d'instance d'un pack, indexes par leur chemin de destination dans
 * l'archive de sortie. Garder le prefixe distingue un fichier client-only
 * d'un fichier commun : ce sont deux destinations differentes.
 */
export function extractOverrides(
  entries: ZipEntries,
  pack: Pick<ParsedPack, "format"> & Partial<Pick<ParsedPack, "rootPrefix">>,
): Record<string, Uint8Array> {
  // Prototype nul : les clefs sont des chemins issus de l'archive.
  const out: Record<string, Uint8Array> = Object.create(null);

  if (pack.format === "mrpack") {
    for (const [path, data] of Object.entries(entries)) {
      if (
        path.startsWith("overrides/") ||
        path.startsWith("client-overrides/") ||
        path.startsWith("server-overrides/")
      ) {
        out[path] = data;
      }
    }
    return out;
  }

  if (pack.format === "curseforge") {
    for (const [path, data] of Object.entries(entries)) {
      if (path.startsWith("overrides/")) out[path] = data;
    }
    return out;
  }

  const prefix = pack.rootPrefix ?? commonPrefix(Object.keys(entries));
  for (const [path, data] of Object.entries(entries)) {
    if (/^.*mods\/[^/]+\.jar$/i.test(path)) continue;
    const rel = path.slice(prefix.length);
    if (!rel) continue;
    out[`overrides/${rel}`] = data;
  }
  return out;
}

async function enrichModrinth(mods: PackMod[]) {
  const ids = mods.filter((m) => m.provider === "modrinth" && m.projectId).map((m) => m.projectId!);
  if (!ids.length) return;
  try {
    const byId = new Map((await modrinth.getProjects(ids)).map((p) => [p.projectId, p]));
    for (const m of mods) {
      const p = m.projectId ? byId.get(m.projectId) : undefined;
      if (!p) continue;
      m.name = p.title;
      m.slug = p.slug;
      m.kind = p.kind;
      if (m.env.client === "unknown") m.env.client = p.clientSide ?? "unknown";
      if (m.env.server === "unknown") m.env.server = p.serverSide ?? "unknown";
    }
  } catch {
    /* enrichissement optionnel */
  }
}

async function enrichCurseforge(mods: PackMod[]) {
  const ids = mods.filter((m) => m.provider === "curseforge" && m.projectId).map((m) => m.projectId!);
  if (!ids.length) return;
  try {
    const byId = new Map((await curseforge.getProjects(ids)).map((p) => [p.projectId, p]));
    for (const m of mods) {
      const p = m.projectId ? byId.get(m.projectId) : undefined;
      if (p) {
        m.name = p.title;
        m.slug = p.slug;
        m.kind = p.kind;
      }
    }
  } catch {
    /* enrichissement optionnel */
  }
}
