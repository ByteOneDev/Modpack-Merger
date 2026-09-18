import {
  LOADER_COMPAT,
  type MergeTarget,
  type ModResolution,
  type PackMod,
  type ProviderId,
} from "../types";
import { providerOf } from "../providers";
import { newerThanPicked, pickBestVersion } from "./resolve";

/**
 * Ajoute les dependances requises manquantes.
 *
 * Les deux APIs declarent les dependances au niveau d'une *version* de mod,
 * pas du projet : on part donc des versions retenues, et on descend en
 * largeur tant que de nouvelles dependances apparaissent. La profondeur est
 * bornee pour ne pas boucler sur un cycle declare de travers.
 */

const MAX_DEPTH = 4;

export interface DependencyAddition {
  resolution: ModResolution;
  requiredBy: string[];
}

export async function resolveDependencies(
  resolutions: ModResolution[],
  target: MergeTarget,
): Promise<DependencyAddition[]> {
  const loaders = LOADER_COMPAT[target.loader];
  const mc = [target.minecraft];

  const present = new Set<string>();
  for (const r of resolutions) {
    if (r.status !== "ok" && r.status !== "substituted") continue;
    if (r.picked) present.add(`${r.picked.provider}:${r.picked.projectId}`);
    if (r.source?.projectId && r.source.provider !== "unknown") {
      present.add(`${r.source.provider}:${r.source.projectId}`);
    }
  }

  const added = new Map<string, DependencyAddition>();
  let frontier = resolutions.filter(
    (r) => (r.status === "ok" || r.status === "substituted") && r.picked,
  );

  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const wanted = new Map<string, { provider: ProviderId; id: string; by: string[] }>();

    for (const r of frontier) {
      for (const dep of r.picked?.dependencies ?? []) {
        if (dep.type !== "required" || !dep.projectId) continue;
        const id = `${dep.provider}:${dep.projectId}`;
        if (present.has(id)) continue;
        const entry = wanted.get(id);
        if (entry) entry.by.push(r.name);
        else wanted.set(id, { provider: dep.provider, id: dep.projectId, by: [r.name] });
      }
    }

    if (!wanted.size) break;
    const next: ModResolution[] = [];

    for (const [id, { provider, id: projectId, by }] of wanted) {
      present.add(id); // marque avant resolution : evite les doublons concurrents

      const [firstTry, project] = await Promise.all([
        providerOf(provider).getVersions(projectId, loaders, mc).catch(() => []),
        providerOf(provider).getProject(projectId).catch(() => null),
      ]);
      let versions = firstTry;
      // Les deux appels partent ensemble pour la vitesse, donc le premier
      // ignore le type. Si la dependance n'est pas un mod, il a interroge les
      // mauvais loaders : on rejoue une fois, avec la bonne categorie.
      const kind = project?.kind ?? "mod";
      if (!versions.length && kind !== "mod") {
        versions = await providerOf(provider)
          .getVersions(projectId, loaders, mc, kind)
          .catch(() => []);
      }
      const picked = pickBestVersion(versions, target, true, kind);
      const newer = picked ? newerThanPicked(picked, versions, target, kind) : null;
      const name = project?.title ?? `Dependance ${projectId}`;

      const source: PackMod = {
        key: `dep-${provider}-${projectId}`,
        name,
        kind: project?.kind ?? "mod",
        slug: project?.slug,
        provider,
        projectId,
        path: `mods/${picked?.fileName ?? `${projectId}.jar`}`,
        fileName: picked?.fileName ?? `${projectId}.jar`,
        fileSize: picked?.fileSize,
        hashes: picked?.hashes ?? {},
        downloads: picked?.downloadUrl ? [picked.downloadUrl] : [],
        env: {
          client: project?.clientSide ?? "unknown",
          server: project?.serverSide ?? "unknown",
        },
        required: true,
        from: { kind: "dependency" },
      };

      const resolution: ModResolution = picked
        ? {
            key: source.key,
            name,
            kind: source.kind,
            from: { kind: "dependency" },
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
            reason: `Dependance requise par ${by.join(", ")} — ${picked.versionNumber}`,
          }
        : {
            key: source.key,
            name,
            kind: source.kind,
            from: { kind: "dependency" },
            status: "missing",
            source,
            project: project ?? undefined,
            reason: `Dependance requise par ${by.join(", ")}, mais introuvable pour ${target.loader} ${target.minecraft}.`,
          };

      added.set(id, { resolution, requiredBy: by });
      if (picked) next.push(resolution);
    }

    frontier = next;
  }

  return [...added.values()];
}
