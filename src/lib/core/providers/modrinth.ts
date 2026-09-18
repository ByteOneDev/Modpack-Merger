import { request, chunk } from "./http";
import {
  kindFromModrinthType,
  providerLoaders,
  CONTENT_INFO,
  type ContentKind,
} from "@/lib/core/content";
import type {
  EnvSupport,
  ProviderDependency,
  ProviderProject,
  ProviderVersion,
} from "@/lib/core/types";

const API = "https://api.modrinth.com/v2";
const P = "Modrinth";

interface MrFile {
  hashes: { sha1?: string; sha512?: string };
  url: string;
  filename: string;
  primary: boolean;
  size: number;
}

interface MrVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  version_type: "release" | "beta" | "alpha";
  date_published: string;
  loaders: string[];
  game_versions: string[];
  files: MrFile[];
  dependencies: {
    project_id: string | null;
    version_id: string | null;
    dependency_type: "required" | "optional" | "incompatible" | "embedded";
  }[];
}

interface MrProject {
  id: string;
  slug: string;
  project_type?: string;
  title: string;
  description: string;
  downloads: number;
  followers?: number;
  icon_url: string | null;
  categories: string[];
  loaders: string[];
  game_versions: string[];
  updated?: string;
  client_side?: EnvSupport;
  server_side?: EnvSupport;
}

interface MrHit {
  project_id: string;
  slug: string;
  project_type?: string;
  title: string;
  description: string;
  downloads: number;
  follows: number;
  icon_url: string | null;
  categories: string[];
  versions: string[];
  date_modified: string;
  client_side?: EnvSupport;
  server_side?: EnvSupport;
}

function toVersion(v: MrVersion): ProviderVersion {
  const file = v.files.find((f) => f.primary) ?? v.files[0];
  return {
    provider: "modrinth",
    projectId: v.project_id,
    versionId: v.id,
    name: v.name,
    versionNumber: v.version_number,
    versionType: v.version_type,
    datePublished: v.date_published,
    loaders: v.loaders,
    gameVersions: v.game_versions,
    fileName: file?.filename ?? `${v.version_number}.jar`,
    fileSize: file?.size ?? 0,
    downloadUrl: file?.url ?? null,
    hashes: { sha1: file?.hashes.sha1, sha512: file?.hashes.sha512 },
    dependencies: v.dependencies
      .filter((d): d is typeof d & { project_id: string } => !!d.project_id)
      .map(
        (d): ProviderDependency => ({
          provider: "modrinth",
          projectId: d.project_id,
          versionId: d.version_id ?? undefined,
          type: d.dependency_type,
        }),
      ),
  };
}

function toProject(p: MrProject): ProviderProject {
  return {
    provider: "modrinth",
    projectId: p.id,
    kind: kindFromModrinthType(p.project_type, p.loaders ?? []),
    slug: p.slug,
    title: p.title,
    description: p.description,
    downloads: p.downloads,
    follows: p.followers,
    iconUrl: p.icon_url,
    categories: p.categories,
    loaders: p.loaders ?? [],
    gameVersions: p.game_versions ?? [],
    dateModified: p.updated,
    clientSide: p.client_side,
    serverSide: p.server_side,
    // Modrinth redirige /mod/<slug> vers le bon type, mais donner directement
    // le bon segment evite une redirection et un lien trompeur.
    url: `https://modrinth.com/${urlSegment(kindFromModrinthType(p.project_type, p.loaders ?? []))}/${p.slug}`,
    // Modrinth impose la distribution libre : un projet publie y est toujours
    // telechargeable par un tiers.
    allowDistribution: true,
  };
}

function urlSegment(kind: ContentKind): string {
  return kind === "resourcepack" ? "resourcepack"
    : kind === "shaderpack" ? "shader"
    : kind === "datapack" ? "datapack"
    : "mod";
}

export const modrinth = {
  available: () => true,

  async getProject(idOrSlug: string): Promise<ProviderProject | null> {
    const p = await request<MrProject>(`${API}/project/${idOrSlug}`, {
      provider: P,
      nullOn404: true,
    });
    return p ? toProject(p) : null;
  },

  async getProjects(ids: string[]): Promise<ProviderProject[]> {
    const out: ProviderProject[] = [];
    for (const batch of chunk([...new Set(ids)], 100)) {
      const res = await request<MrProject[]>(
        `${API}/projects?ids=${encodeURIComponent(JSON.stringify(batch))}`,
        { provider: P },
      );
      if (res) out.push(...res.map(toProject));
    }
    return out;
  },

  /** Versions d'un projet filtrees par loader + version de Minecraft. */
  async getVersions(
    idOrSlug: string,
    loaders: string[],
    gameVersions: string[],
    kind: ContentKind = "mod",
  ): Promise<ProviderVersion[]> {
    const wanted = providerLoaders(kind, loaders);
    const qs = new URLSearchParams({ game_versions: JSON.stringify(gameVersions) });
    if (wanted.length) qs.set("loaders", JSON.stringify(wanted));
    const res = await request<MrVersion[]>(
      `${API}/project/${idOrSlug}/version?${qs}`,
      { provider: P, nullOn404: true },
    );
    return (res ?? []).map(toVersion);
  },

  /**
   * Une version precise, par son identifiant.
   *
   * Sert aux dependances epinglees : Iris ne demande pas « Sodium », il
   * demande une version donnee de Sodium, parce que ses mixins visent la
   * disposition interne de cette version-la.
   */
  async getVersionById(versionId: string): Promise<ProviderVersion | null> {
    const v = await request<MrVersion>(`${API}/version/${versionId}`, {
      provider: P,
      nullOn404: true,
    });
    return v ? toVersion(v) : null;
  },

  /** Identifie des fichiers a partir de leur sha1 (mods sans metadonnees). */
  async lookupByHashes(
    sha1s: string[],
  ): Promise<Map<string, ProviderVersion>> {
    const map = new Map<string, ProviderVersion>();
    for (const batch of chunk([...new Set(sha1s)], 300)) {
      const res = await request<Record<string, MrVersion>>(
        `${API}/version_files`,
        {
          provider: P,
          method: "POST",
          body: { hashes: batch, algorithm: "sha1" },
        },
      );
      for (const [hash, v] of Object.entries(res ?? {})) {
        map.set(hash.toLowerCase(), toVersion(v));
      }
    }
    return map;
  },

  async search(
    query: string,
    loaders: string[],
    gameVersion: string,
    limit = 20,
    kind: ContentKind = "mod",
  ): Promise<ProviderProject[]> {
    const type = CONTENT_INFO[kind].modrinthType;
    if (!type) return []; // les schematiques ne sont pas un type Modrinth

    const facets: string[][] = [[`project_type:${type}`]];
    // Un resource pack n'est pas publie sous "fabric" : filtrer par le loader
    // du pack ne renverrait rien du tout.
    const wanted = providerLoaders(kind, loaders);
    if (kind === "mod" && wanted.length) facets.push(wanted.map((l) => `categories:${l}`));
    if (gameVersion) facets.push([`versions:${gameVersion}`]);

    const qs = new URLSearchParams({
      query,
      limit: String(limit),
      index: "relevance",
      facets: JSON.stringify(facets),
    });
    const res = await request<{ hits: MrHit[] }>(`${API}/search?${qs}`, {
      provider: P,
    });
    return (res?.hits ?? []).map((h) => ({
      provider: "modrinth" as const,
      projectId: h.project_id,
      kind: kindFromModrinthType(h.project_type, h.categories ?? []),
      slug: h.slug,
      title: h.title,
      description: h.description,
      downloads: h.downloads,
      follows: h.follows,
      iconUrl: h.icon_url,
      categories: h.categories,
      loaders: h.categories,
      gameVersions: h.versions,
      dateModified: h.date_modified,
      clientSide: h.client_side,
      serverSide: h.server_side,
      url: `https://modrinth.com/${urlSegment(kindFromModrinthType(h.project_type, h.categories ?? []))}/${h.slug}`,
      allowDistribution: true,
    }));
  },

  async gameVersions(): Promise<string[]> {
    const res = await request<{ version: string; version_type: string }[]>(
      `${API}/tag/game_version`,
      { provider: P },
    );
    return (res ?? [])
      .filter((v) => v.version_type === "release")
      .map((v) => v.version);
  },
};
