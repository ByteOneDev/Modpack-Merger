import { providerOf } from "../providers";
import type { ModResolution, ProviderVersion } from "../types";

/**
 * Dependances epinglees sur une version precise.
 *
 * « La version la plus recente de chaque mod » et « un ensemble qui demarre »
 * ne sont pas la meme chose. Certains mods ne se contentent pas d'exiger un
 * autre mod : ils exigent une version donnee, parce qu'ils reecrivent ses
 * classes internes. Iris 1.8.12 epingle Sodium 0.6.13 ; installe a cote de
 * Sodium 0.8.13, il cherche une classe qui a change de place et le jeu plante
 * au chargement du monde, sans le moindre avertissement a l'installation.
 *
 * Modrinth porte cette information dans ses declarations de dependance, sous
 * forme d'un identifiant de version. CurseForge ne la porte pas : ses
 * dependances ne designent qu'un projet. Ce controle ne couvre donc que ce
 * que Modrinth declare — c'est mieux que rien, ce n'est pas exhaustif.
 */

export interface PinnedConflict {
  /** cle de resolution du mod qui impose la contrainte */
  dependentKey: string;
  dependentName: string;
  dependentVersion: string;
  /** cle de resolution du mod dont la version ne convient pas */
  dependencyKey: string;
  dependencyName: string;
  /** version actuellement retenue */
  installedVersion: string;
  installedVersionId: string;
  /** version exigee */
  requiredVersionId: string;
  /** numero lisible de la version exigee, une fois resolu */
  requiredVersion?: string;
}

/**
 * Compare les versions retenues aux versions exigees.
 *
 * Seules les dependances requises comptent : une dependance optionnelle
 * epinglee signale une compatibilite connue, pas une obligation.
 */
export function detectPinnedConflicts(resolutions: ModResolution[]): PinnedConflict[] {
  const kept = resolutions.filter(
    (r) => (r.status === "ok" || r.status === "substituted") && r.picked,
  );

  const parProjet = new Map<string, ModResolution>();
  for (const r of kept) {
    parProjet.set(`${r.picked!.provider}:${r.picked!.projectId}`, r);
  }

  const out: PinnedConflict[] = [];
  for (const r of kept) {
    for (const d of r.picked!.dependencies) {
      if (d.type !== "required" || !d.projectId || !d.versionId) continue;

      const cible = parProjet.get(`${d.provider}:${d.projectId}`);
      if (!cible?.picked) continue;
      if (cible.picked.versionId === d.versionId) continue;

      out.push({
        dependentKey: r.key,
        dependentName: r.name,
        dependentVersion: r.picked!.versionNumber,
        dependencyKey: cible.key,
        dependencyName: cible.name,
        installedVersion: cible.picked.versionNumber,
        installedVersionId: cible.picked.versionId,
        requiredVersionId: d.versionId,
      });
    }
  }
  return out;
}

/**
 * Resout les numeros de version exiges, pour pouvoir les montrer.
 *
 * Une seule requete par version distincte : sur un pack entier les conflits
 * se comptent sur les doigts d'une main.
 */
export async function describePinned(
  conflicts: PinnedConflict[],
  resolutions: ModResolution[],
): Promise<PinnedConflict[]> {
  const parCle = new Map(resolutions.map((r) => [r.key, r]));
  const cache = new Map<string, ProviderVersion | null>();

  const out: PinnedConflict[] = [];
  for (const c of conflicts) {
    const cible = parCle.get(c.dependencyKey);
    const provider = cible?.picked?.provider;
    if (!provider) {
      out.push(c);
      continue;
    }
    if (!cache.has(c.requiredVersionId)) {
      cache.set(
        c.requiredVersionId,
        await providerOf(provider).getVersionById(c.requiredVersionId).catch(() => null),
      );
    }
    const v = cache.get(c.requiredVersionId);
    out.push({ ...c, requiredVersion: v?.versionNumber });
  }
  return out;
}

/** Recupere la version exigee, prete a remplacer celle retenue. */
export async function fetchPinnedVersion(
  conflict: PinnedConflict,
  resolutions: ModResolution[],
): Promise<ProviderVersion | null> {
  const cible = resolutions.find((r) => r.key === conflict.dependencyKey);
  const provider = cible?.picked?.provider;
  if (!provider) return null;
  return providerOf(provider).getVersionById(conflict.requiredVersionId).catch(() => null);
}
