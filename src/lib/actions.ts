"use client";

import { providerOf } from "@/lib/core/providers";
import { pickBestVersion } from "@/lib/core/merge/resolve";
import { resolveDependencies } from "@/lib/core/merge/deps";
import { detectFunctionalConflicts } from "@/lib/core/merge/functional";
import { estimateRam } from "@/lib/core/merge/ram";
import {
  LOADER_COMPAT,
  type Alternative,
  type MergeTarget,
  type ModResolution,
  type PackMod,
  type ProviderId,
} from "@/lib/core/types";
import type { MergeState } from "@/lib/store";
import type { Settings } from "@/lib/settings";

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
    api.getVersions(projectId, LOADER_COMPAT[target.loader], [target.minecraft]).catch(() => []),
    api.getProject(projectId).catch(() => null),
  ]);

  const picked = pickBestVersion(versions, target, settings.preferStable);
  if (!picked) {
    return {
      error: `${project?.title ?? "Ce mod"} n'a pas de version pour ${target.loader} ${target.minecraft}.`,
    };
  }

  const name = project?.title ?? picked.name;
  const source: PackMod = {
    key: `manual-${provider}-${projectId}`,
    name,
    slug: project?.slug,
    provider,
    projectId,
    path: `mods/${picked.fileName}`,
    fileName: picked.fileName,
    fileSize: picked.fileSize,
    hashes: picked.hashes,
    downloads: picked.downloadUrl ? [picked.downloadUrl] : [],
    env: {
      client: project?.clientSide ?? "unknown",
      server: project?.serverSide ?? "unknown",
    },
    required: true,
    from: { kind: "manual" },
  };

  const added: ModResolution = {
    key: source.key,
    name,
    from: { kind: "manual" },
    status: "ok",
    source,
    picked,
    project: project ?? undefined,
    unstable: picked.versionType !== "release",
    reason: `Ajoute a la main — ${picked.versionNumber} (${picked.versionType})`,
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
