"use client";

import { providerOf } from "@/lib/core/providers";
import { newerThanPicked, pickBestVersion } from "@/lib/core/merge/resolve";
import { resolveDependencies } from "@/lib/core/merge/deps";
import { detectFunctionalConflicts } from "@/lib/core/merge/functional";
import {
  detectPinnedConflicts, fetchPinnedVersion, type PinnedConflict,
} from "@/lib/core/merge/pinned";
import { estimateRam } from "@/lib/core/merge/ram";
import {
  LOADER_COMPAT,
  type Alternative,
  type MergeTarget,
  type ModResolution,
  type PackMod,
  type ProviderId,
  type ProviderVersion,
} from "@/lib/core/types";
import { sha1 } from "@/lib/core/hash";
import { storeManualFile } from "@/lib/manual";
import type { MergeState } from "@/lib/store";
import type { Settings } from "@/lib/settings";
import { CONTENT_INFO, type ContentKind } from "@/lib/core/content";

/**
 * Cote par defaut quand la source ne le precise pas. Un shader ne sert a rien
 * sur un serveur, un datapack ne sert a rien sans monde a charger.
 */
function defaultEnv(kind: ContentKind, side: "client" | "server") {
  const declared = CONTENT_INFO[kind].side;
  if (declared === "both") return "unknown" as const;
  return declared === side ? ("required" as const) : ("unsupported" as const);
}

/**
 * Actions de l'etape "Mods". Tout se passe en memoire : il n'y a pas de
 * serveur, l'etat est recalcule localement puis reinjecte dans le store.
 */

/** Recalcule ce qui depend de la liste de mods : conflits et memoire. */
function withDerived(
  state: MergeState,
  resolutions: ModResolution[],
  settings: Settings,
): Partial<MergeState> {
  return {
    resolutions,
    conflicts: settings.detectFunctionalConflicts
      ? detectFunctionalConflicts(resolutions)
      : [],
    // Toujours calcule : une version epinglee non respectee ne degrade pas
    // le pack, elle le fait planter au chargement.
    pinnedConflicts: detectPinnedConflicts(resolutions),
    ram: state.target
      ? estimateRam(resolutions, state.target.minecraft, {
          hasShaders: state.packs.some((p) =>
            p.overridePaths.some((f) => f.includes("shaderpacks/")),
          ),
          hasResourcePacks: state.packs.some((p) =>
            p.overridePaths.some((f) => f.includes("resourcepacks/")),
          ),
        })
      : state.ram,
  };
}

export function excludeMod(
  state: MergeState,
  key: string,
  settings: Settings,
): Partial<MergeState> {
  const resolutions = state.resolutions.map((r) =>
    r.key === key
      ? { ...r, status: "excluded" as const, picked: undefined, reason: "Ecarte manuellement." }
      : r,
  );
  return withDerived(state, resolutions, settings);
}

/**
 * Ecarte plusieurs elements d'un coup.
 *
 * Sert de sortie assumee quand l'export est bloque : plutot qu'un
 * contournement silencieux, l'utilisateur decide de se passer de ces
 * elements, et le rapport de fusion le consigne.
 */
export function excludeMany(
  state: MergeState,
  keys: string[],
  settings: Settings,
  raison = "Ecarte volontairement : introuvable ou non telechargeable.",
): Partial<MergeState> {
  const cibles = new Set(keys);
  const resolutions = state.resolutions.map((r) =>
    cibles.has(r.key)
      ? { ...r, status: "excluded" as const, picked: undefined, reason: raison }
      : r,
  );
  return {
    ...withDerived(state, resolutions, settings),
    // Ces cles ne bloquent plus rien : elles ne font plus partie du pack.
    failedDownloads: state.failedDownloads.filter((k) => !cibles.has(k)),
  };
}

export function restoreMod(
  state: MergeState,
  key: string,
  settings: Settings,
): Partial<MergeState> {
  const resolutions = state.resolutions.map((r) => {
    if (r.key !== key) return r;
    if (!r.picked) {
      return { ...r, status: "missing" as const, reason: "Remis dans la liste, sans version trouvee." };
    }
    return {
      ...r,
      status: "ok" as const,
      reason: `${r.picked.versionNumber} (${r.picked.versionType})`,
    };
  });
  return withDerived(state, resolutions, settings);
}

/**
 * Applique plusieurs remplacements en une passe.
 *
 * Passer par applyAlternative en boucle recalculerait les conflits, la memoire
 * et surtout les dependances a chaque mod : sur quelques centaines de
 * substitutions, cela represente des milliers de requetes inutiles. Ici les
 * substitutions sont posees d'abord, et tout ce qui en derive est calcule une
 * seule fois a la fin.
 */
export async function applyAlternatives(
  state: MergeState,
  picks: { key: string; alt: Alternative }[],
  settings: Settings,
  onProgress?: (done: number, total: number) => void,
): Promise<Partial<MergeState>> {
  if (!state.target) return {};

  const byKey = new Map(picks.map((p) => [p.key, p.alt]));
  // Ce que le pack contient deja, pour reperer les substitutions qui font
  // doublon — y compris entre elles (deux mods remplaces par le meme).
  const taken = new Set(
    state.resolutions
      .filter((r) => (r.status === "ok" || r.status === "substituted") && r.picked)
      .map((r) => `${r.picked!.provider}:${r.picked!.projectId}`),
  );

  let done = 0;
  const resolutions = state.resolutions.map((r) => {
    const alt = byKey.get(r.key);
    if (!alt) return r;

    onProgress?.(++done, picks.length);
    const id = `${alt.version.provider}:${alt.project.projectId}`;

    if (taken.has(id)) {
      return {
        ...r,
        status: "duplicate" as const,
        picked: undefined,
        reason: `${alt.project.title} est deja dans le pack et couvre cette fonction : rien a ajouter.`,
      };
    }
    taken.add(id);

    const original = r.source?.name ?? r.name;
    const replacement = alt.project.title;
    return {
      ...r,
      name: replacement === original ? replacement : `${replacement} (remplace ${original})`,
      status: "substituted" as const,
      picked: alt.version,
      project: alt.project,
      unstable: alt.version.versionType !== "release",
      reason: `Remplace ${original} — ${replacement} ${alt.version.versionNumber}`,
    };
  });

  let full = resolutions;
  if (settings.autoDependencies) {
    const additions = await resolveDependencies(resolutions, state.target).catch(() => []);
    const fresh = additions.filter((a) => !resolutions.some((r) => r.key === a.resolution.key));
    full = [...resolutions, ...fresh.map((a) => a.resolution)];
  }

  return withDerived(state, full, settings);
}

export async function applyAlternative(
  state: MergeState,
  key: string,
  alt: Alternative,
  settings: Settings,
): Promise<Partial<MergeState> & { error?: string }> {
  const current = state.resolutions.find((r) => r.key === key);
  if (!current || !state.target) return { error: "Mod introuvable." };

  // Le remplacant est peut-etre deja dans le pack (remplacer Embeddium par
  // Sodium quand Sodium vient d'un autre pack) : c'est un doublon, pas un
  // conflit a arbitrer plus tard.
  const already = state.resolutions.find(
    (r) =>
      r.key !== key &&
      (r.status === "ok" || r.status === "substituted") &&
      r.picked?.provider === alt.version.provider &&
      r.picked?.projectId === alt.project.projectId,
  );

  const resolutions = state.resolutions.map((r) => {
    if (r.key !== key) return r;
    if (already) {
      return {
        ...r,
        status: "duplicate" as const,
        picked: undefined,
        reason: `${already.name} est deja dans le pack et couvre cette fonction : rien a ajouter.`,
      };
    }
    const original = r.source?.name ?? r.name;
    const replacement = alt.project.title;
    return {
      ...r,
      // Le mod porte le nom de son remplacant : sinon les ecrans de conflits
      // proposeraient "garder Embeddium" pour un mod qui installe Sodium.
      name: replacement === original ? replacement : `${replacement} (remplace ${original})`,
      status: "substituted" as const,
      picked: alt.version,
      project: alt.project,
      unstable: alt.version.versionType !== "release",
      reason: `Remplace ${original} — ${replacement} ${alt.version.versionNumber}`,
    };
  });

  // Le remplacant a ses propres dependances
  let full = resolutions;
  if (settings.autoDependencies && !already) {
    const additions = await resolveDependencies(resolutions, state.target).catch(() => []);
    const fresh = additions.filter((a) => !resolutions.some((r) => r.key === a.resolution.key));
    full = [...resolutions, ...fresh.map((a) => a.resolution)];
  }

  return withDerived(state, full, settings);
}

export async function addMod(
  state: MergeState,
  provider: ProviderId,
  projectId: string,
  settings: Settings,
  kind: ContentKind = "mod",
): Promise<Partial<MergeState> & { error?: string; addedName?: string; addedDeps?: number }> {
  const target: MergeTarget | null = state.target;
  if (!target) return { error: "Lance d'abord l'analyse." };

  const already = state.resolutions.find(
    (r) =>
      (r.status === "ok" || r.status === "substituted") &&
      r.picked?.provider === provider &&
      r.picked?.projectId === projectId,
  );
  if (already) return { error: `${already.name} est deja dans le pack.` };

  const api = providerOf(provider);
  const [versions, project] = await Promise.all([
    api
      .getVersions(projectId, LOADER_COMPAT[target.loader], [target.minecraft], kind)
      .catch(() => []),
    api.getProject(projectId).catch(() => null),
  ]);

  const picked = pickBestVersion(versions, target, settings.preferStable, kind);
  if (!picked) {
    const what = CONTENT_INFO[kind].label;
    return {
      error:
        kind === "mod"
          ? `${project?.title ?? "Ce mod"} n'a pas de version pour ${target.loader} ${target.minecraft}.`
          : `${project?.title ?? `Ce ${what}`} n'a pas de version pour Minecraft ${target.minecraft}.`,
    };
  }

  const name = project?.title ?? picked.name;
  const source: PackMod = {
    key: `manual-${provider}-${projectId}`,
    name,
    kind,
    slug: project?.slug,
    provider,
    projectId,
    path: `${CONTENT_INFO[kind].folder}/${picked.fileName}`,
    fileName: picked.fileName,
    fileSize: picked.fileSize,
    hashes: picked.hashes,
    downloads: picked.downloadUrl ? [picked.downloadUrl] : [],
    env: {
      client: project?.clientSide ?? defaultEnv(kind, "client"),
      server: project?.serverSide ?? defaultEnv(kind, "server"),
    },
    required: true,
    from: { kind: "manual" },
  };

  // Meme signalement que pour les mods issus des packs : si une version plus
  // recente existe mais n'est pas stable, il faut pouvoir le voir.
  const newer = newerThanPicked(picked, versions, target, kind);

  const added: ModResolution = {
    key: source.key,
    name,
    kind,
    from: { kind: "manual" },
    status: "ok",
    source,
    picked,
    project: project ?? undefined,
    unstable: picked.versionType !== "release",
    newerAvailable: newer
      ? {
          versionNumber: newer.versionNumber,
          versionType: newer.versionType,
          datePublished: newer.datePublished,
        }
      : undefined,
    reason:
      `Ajoute a la main — ${picked.versionNumber} (${picked.versionType})` +
      (newer ? ` — ${newer.versionNumber} est plus recente mais en ${newer.versionType}` : ""),
  };

  const resolutions = [...state.resolutions, added];

  let full = resolutions;
  let depCount = 0;
  if (settings.autoDependencies) {
    const additions = await resolveDependencies(resolutions, target).catch(() => []);
    const fresh = additions.filter((a) => !resolutions.some((r) => r.key === a.resolution.key));
    depCount = fresh.length;
    full = [...resolutions, ...fresh.map((a) => a.resolution)];
  }

  return { ...withDerived(state, full, settings), addedName: name, addedDeps: depCount };
}

/**
 * Ajoute des schematiques fournies par l'utilisateur.
 *
 * Il n'y a pas de projet a resoudre : le fichier est deja la. On lui fabrique
 * une resolution pour qu'il suive le meme chemin que le reste jusqu'a
 * l'archive, et les octets sont ranges avec les autres fichiers manuels.
 */
export async function addSchematics(
  state: MergeState,
  files: { name: string; size: number; bytes: Uint8Array }[],
  settings: Settings,
): Promise<Partial<MergeState> & { addedCount: number }> {
  const manualFiles = { ...state.manualFiles };
  const added: ModResolution[] = [];

  for (const file of files) {
    const digest = sha1(file.bytes);
    const key = `schematic-${digest.slice(0, 16)}`;
    if (state.resolutions.some((r) => r.key === key)) continue;

    await storeManualFile(key, file.bytes);
    manualFiles[key] = {
      fileName: file.name,
      size: file.size,
      sha1: digest,
      verified: true,
    };

    const picked: ProviderVersion = {
      provider: "modrinth", // valeur de forme : rien n'est interroge en ligne
      projectId: key,
      versionId: digest,
      name: file.name,
      versionNumber: "fichier local",
      versionType: "release",
      datePublished: new Date().toISOString(),
      loaders: [],
      gameVersions: state.target ? [state.target.minecraft] : [],
      fileName: file.name,
      fileSize: file.size,
      downloadUrl: null,
      hashes: { sha1: digest },
      dependencies: [],
      local: true,
    };

    added.push({
      key,
      name: file.name.replace(/\.[a-z0-9]+$/i, ""),
      kind: "schematic",
      from: { kind: "manual" },
      status: "ok",
      picked,
      reason: `Schematique fournie a la main — ${file.name}`,
    });
  }

  if (!added.length) return { addedCount: 0 };

  return {
    ...withDerived(state, [...state.resolutions, ...added], settings),
    manualFiles,
    addedCount: added.length,
  };
}

/**
 * Remplace une dependance par la version exacte que son dependant exige.
 *
 * C'est une retrogradation assumee : la version la plus recente n'est pas
 * toujours celle qui fonctionne. Le rapport de fusion garde la raison.
 */
export async function alignPinnedVersion(
  state: MergeState,
  conflict: PinnedConflict,
  settings: Settings,
): Promise<Partial<MergeState> & { error?: string }> {
  const version = await fetchPinnedVersion(conflict, state.resolutions);
  if (!version) {
    return { error: `Version ${conflict.requiredVersionId} introuvable sur la plateforme.` };
  }

  const resolutions = state.resolutions.map((r) =>
    r.key === conflict.dependencyKey
      ? {
          ...r,
          picked: version,
          unstable: version.versionType !== "release",
          newerAvailable: {
            versionNumber: conflict.installedVersion,
            versionType: "release",
            datePublished: "",
          },
          reason:
            `${version.versionNumber} — version exigee par ${conflict.dependentName} ` +
            `${conflict.dependentVersion} (${conflict.installedVersion} etait plus recente ` +
            "mais incompatible)",
        }
      : r,
  );

  return withDerived(state, resolutions, settings);
}

/** Garde un seul mod d'un groupe en conflit et ecarte les autres. */
export function resolveConflict(
  state: MergeState,
  keepKey: string,
  memberKeys: string[],
  settings: Settings,
): Partial<MergeState> {
  const drop = new Set(memberKeys.filter((k) => k !== keepKey));
  const keeper = state.resolutions.find((r) => r.key === keepKey);
  const resolutions = state.resolutions.map((r) =>
    drop.has(r.key)
      ? {
          ...r,
          status: "excluded" as const,
          picked: undefined,
          reason: `Ecarte au profit de ${keeper?.name ?? "l'autre mod"}.`,
        }
      : r,
  );
  return withDerived(state, resolutions, settings);
}
