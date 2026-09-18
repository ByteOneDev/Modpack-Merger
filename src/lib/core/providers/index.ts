import { modrinth } from "./modrinth";
import { curseforge } from "./curseforge";
import type { ProviderId, ProviderProject, ProviderVersion } from "@/lib/core/types";
import { CONTENT_INFO, type ContentKind } from "@/lib/core/content";

export { modrinth, curseforge };

export function providerOf(id: ProviderId) {
  return id === "modrinth" ? modrinth : curseforge;
}

export function activeProviders(): ProviderId[] {
  const out: ProviderId[] = ["modrinth"];
  if (curseforge.available()) out.push("curseforge");
  return out;
}

/** Recherche sur toutes les sources disponibles, resultats fusionnes. */
export async function searchAll(
  query: string,
  loaders: string[],
  gameVersion: string,
  limit = 20,
  kind: ContentKind = "mod",
): Promise<ProviderProject[]> {
  const info = CONTENT_INFO[kind];
  if (!info.modrinthType && info.curseforgeClass === null) return [];

  const results = await Promise.allSettled(
    activeProviders().map((p) =>
      providerOf(p).search(query, loaders, gameVersion, limit, kind),
    ),
  );
  const flat = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

  // Les memes mods existent des deux cotes : on garde une entree par titre
  // normalise, en privilegiant Modrinth (metadonnees plus riches, pas de cle).
  const seen = new Map<string, ProviderProject>();
  for (const p of flat) {
    const k = normalizeTitle(p.title);
    const prev = seen.get(k);
    if (!prev || (prev.provider === "curseforge" && p.provider === "modrinth")) {
      seen.set(k, p);
    }
  }
  return [...seen.values()].sort((a, b) => b.downloads - a.downloads);
}

/** Toutes les versions d'un projet, toutes sources confondues. */
export async function versionsFor(
  provider: ProviderId,
  projectId: string,
  loaders: string[],
  gameVersions: string[],
  kind: ContentKind = "mod",
): Promise<ProviderVersion[]> {
  return providerOf(provider).getVersions(projectId, loaders, gameVersions, kind);
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\b(fabric|forge|neoforge|quilt|port|edition|mod|continued|reforged|refabricated|unofficial)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}
