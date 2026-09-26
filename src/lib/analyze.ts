"use client";

import { listZipEntries, readZip } from "@/lib/core/zip";
import { extractOverrides, isRawJar, overridePathOf } from "@/lib/core/parse";
import { dedupe, enrichEnvironments, resolveAll } from "@/lib/core/merge/resolve";
import { resolveDependencies } from "@/lib/core/merge/deps";
import { detectFunctionalConflicts } from "@/lib/core/merge/functional";
import { detectPinnedConflicts } from "@/lib/core/merge/pinned";
import {
  computeOverrideConflicts, reliableDates, type PackFiles,
} from "@/lib/core/merge/overrides";
import { estimateRam } from "@/lib/core/merge/ram";
import { collapseDuplicates } from "@/lib/core/merge/duplicates";
import { loadArchive } from "@/lib/archives";
import type { Settings } from "@/lib/settings";
import type { MergeState } from "@/lib/store";
import type { MergeTarget, ParsedPack } from "@/lib/core/types";

export interface AnalyzeProgress {
  phase: string;
  done: number;
  total: number;
}

/**
 * Relit les archives et reconstitue les fichiers d'instance de chaque pack.
 * Les packs sont parcourus dans l'ordre de priorite choisi par l'utilisateur.
 */
export async function readPackFiles(packs: ParsedPack[]): Promise<PackFiles[]> {
  const out: PackFiles[] = [];
  for (const pack of packs) {
    const buf = await loadArchive(pack.id);
    if (!buf) continue;

    // Dates lues dans le catalogue, sans rien decompresser : elles servent a
    // designer la version la plus recente d'un fichier en conflit.
    const dates: Record<string, number> = {};
    for (const e of listZipEntries(buf)) {
      const dest = overridePathOf(e.path, pack.format, pack.rootPrefix ?? "");
      if (dest && e.modified !== undefined) dates[dest] = e.modified;
    }

    out.push({
      packId: pack.id,
      label: pack.label,
      dates: reliableDates(dates),
      // Les jars sont exclus avant decompression : ils representent l'essentiel
      // du poids d'un pack et ne servent pas a comparer des configurations.
      files: extractOverrides(
        readZip(buf, (path) =>
          // Une archive brute lit tous ses jars comme des mods, ou qu'ils soient.
          pack.format === "raw"
            ? !isRawJar(path)
            : !/(^|\/)mods\/[^/]+\.jar$/i.test(path),
        ),
        pack,
      ),
    });
  }
  return out;
}

/** Lance la fusion complete. Tout s'execute dans le navigateur. */
export async function runAnalysis(
  packs: ParsedPack[],
  target: MergeTarget,
  settings: Settings,
  onProgress: (p: AnalyzeProgress) => void,
): Promise<Omit<MergeState, "packs" | "target">> {
  const labelById = new Map(packs.map((p) => [p.id, p.label]));

  // 1. deduplication de tous les mods, tous packs confondus
  onProgress({ phase: "Regroupement des mods", done: 0, total: 1 });
  const allMods = packs.flatMap((p) => p.mods);
  const groups = dedupe(allMods, (m) =>
    m.from.kind === "pack" ? (labelById.get(m.from.packId) ?? "?") : "?",
  );

  // 2. resolution de chaque mod vers la cible
  const resolutions = await resolveAll(groups, target, {
    preferStable: settings.preferStable,
    onProgress: (done, total) =>
      onProgress({ phase: "Recherche des mods", done, total }),
  });

  // 3. dependances requises manquantes
  let withDeps = resolutions;
  if (settings.autoDependencies) {
    onProgress({ phase: "Resolution des dependances", done: 0, total: 1 });
    const additions = await resolveDependencies(resolutions, target);
    withDeps = [...resolutions, ...additions.map((a) => a.resolution)];
    // Les dependances viennent d'arriver : elles n'ont pas encore leur cote
    // client/serveur si elles sortent de CurseForge.
    await enrichEnvironments(withDeps).catch(() => {});
    onProgress({ phase: "Resolution des dependances", done: 1, total: 1 });
  }

  // 3 bis. un meme mod arrive par deux chemins (pack CurseForge et
  // dependance Modrinth, par exemple) : seule la version la plus recente reste.
  withDeps = collapseDuplicates(withDeps);

  // 4. doublons fonctionnels
  const conflicts = settings.detectFunctionalConflicts
    ? detectFunctionalConflicts(withDeps)
    : [];

  // 4 bis. dependances exigeant une version precise. Toujours verifie : un
  // mod qui reecrit les classes d'un autre plante si la version ne correspond
  // pas, et rien ne le signale avant le chargement du monde.
  const pinnedConflicts = detectPinnedConflicts(withDeps);

  // 5. conflits de fichiers d'instance
  onProgress({ phase: "Comparaison des fichiers de configuration", done: 0, total: 1 });
  const packFiles = await readPackFiles(packs);
  const { conflicts: overrideConflicts, uniqueCount, identicalCount } =
    computeOverrideConflicts(packFiles);

  // Seules les suggestions sures sont appliquees d'office ; les autres
  // attendent une confirmation, et bloquent l'export tant qu'elle manque.
  const decisions: Record<string, string> = {};
  for (const c of overrideConflicts) if (c.auto) decisions[c.path] = c.suggestion;

  // 6. estimation memoire
  const hasShaders = packs.some((p) =>
    p.overridePaths.some((f) => f.includes("shaderpacks/")),
  );
  const hasResourcePacks = packs.some((p) =>
    p.overridePaths.some((f) => f.includes("resourcepacks/")),
  );
  const ram = estimateRam(withDeps, target.minecraft, { hasShaders, hasResourcePacks });

  onProgress({ phase: "Termine", done: 1, total: 1 });

  return {
    resolutions: withDeps,
    conflicts,
    pinnedConflicts,
    overrideConflicts,
    overrideStats: { uniqueCount, identicalCount },
    decisions,
    ram,
    analyzed: true,
    manualFiles: {},
    failedDownloads: [],
  };
}
