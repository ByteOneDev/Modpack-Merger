import { request, chunk } from "./http";
import { getProviderConfig, effectiveCurseforgeBase } from "./config";
import type {
  ProviderDependency,
  ProviderProject,
  ProviderVersion,
} from "@/lib/core/types";

/**
 * Client CurseForge.
 *
 * L'API CurseForge exige une cle secrete et n'autorise pas les appels
 * navigateur : une application statique ne peut donc pas l'interroger
 * directement, et y glisser une cle la rendrait publique. Tous les appels
 * passent par un proxy que l'utilisateur deploie et renseigne dans les
 * reglages ; sans proxy, la source est simplement inactive.
 */

const P = "CurseForge";
const GAME_ID = 432;
const CLASS_MODS = 6;

const LOADER_TYPE: Record<string, number> = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6,
};

const LOADER_NAMES = new Set([
  "forge", "fabric", "quilt", "neoforge", "liteloader", "cauldron",
]);

function base(): string | null {
  return effectiveCurseforgeBase();
}

interface CfHash { value: string; algo: number }

interface CfFile {
  id: number;
  modId: number;
  displayName: string;
  fileName: string;
  releaseType: number;
  fileDate: string;
  fileLength: number;
  downloadUrl: string | null;
  gameVersions: string[];
  hashes: CfHash[];
  dependencies: { modId: number; relationType: number }[];
  fileFingerprint?: number;
}

interface CfMod {
  id: number;
  name: string;
  slug: string;
  summary: string;
  downloadCount: number;
  thumbsUpCount?: number;
  dateModified: string;
  logo?: { thumbnailUrl: string } | null;
  categories: { name: string; slug: string }[];
  latestFilesIndexes?: { gameVersion: string; modLoader?: number }[];
  links?: { websiteUrl?: string };
}

/**
 * Lien de repli quand l'auteur a desactive la distribution tierce : l'API
 * renvoie downloadUrl = null mais le CDN reste adressable.
 */
function cdnFallback(fileId: number, fileName: string): string {
  return `https://edge.forgecdn.net/files/${Math.floor(fileId / 1000)}/${fileId % 1000}/${encodeURIComponent(fileName)}`;
}

function toVersion(f: CfFile): ProviderVersion {
  const loaders = f.gameVersions
    .map((g) => g.toLowerCase())
    .filter((g) => LOADER_NAMES.has(g));
  const gameVersions = f.gameVersions.filter(
    (g) => /^\d/.test(g) && !LOADER_NAMES.has(g.toLowerCase()),
  );
  return {
    provider: "curseforge",
    projectId: String(f.modId),
    versionId: String(f.id),
    name: f.displayName,
    versionNumber: f.displayName,
    versionType: f.releaseType === 1 ? "release" : f.releaseType === 2 ? "beta" : "alpha",
    datePublished: f.fileDate,
    loaders,
    gameVersions,
    fileName: f.fileName,
    fileSize: f.fileLength,
    downloadUrl: f.downloadUrl ?? cdnFallback(f.id, f.fileName),
    hashes: { sha1: f.hashes?.find((h) => h.algo === 1)?.value?.toLowerCase() },
    dependencies: (f.dependencies ?? [])
      .map((d): ProviderDependency | null => {
        const type =
          d.relationType === 3 ? ("required" as const)
          : d.relationType === 2 ? ("optional" as const)
          : d.relationType === 5 ? ("incompatible" as const)
          : d.relationType === 1 ? ("embedded" as const)
          : null;
        return type ? { provider: "curseforge", projectId: String(d.modId), type } : null;
      })
      .filter((d): d is ProviderDependency => d !== null),
  };
}

function toProject(m: CfMod): ProviderProject {
  const loaders = [
    ...new Set(
      (m.latestFilesIndexes ?? [])
        .map((i) => i.modLoader)
        .filter((n): n is number => typeof n === "number")
        .map((n) => Object.entries(LOADER_TYPE).find(([, v]) => v === n)?.[0] ?? "")
        .filter(Boolean),
    ),
  ];
  return {
    provider: "curseforge",
    projectId: String(m.id),
    slug: m.slug,
    title: m.name,
    description: m.summary,
    downloads: m.downloadCount,
    follows: m.thumbsUpCount,
    iconUrl: m.logo?.thumbnailUrl ?? null,
    categories: m.categories?.map((c) => c.slug) ?? [],
    loaders,
    gameVersions: [...new Set((m.latestFilesIndexes ?? []).map((i) => i.gameVersion))],
    dateModified: m.dateModified,
    url: m.links?.websiteUrl ?? `https://www.curseforge.com/minecraft/mc-mods/${m.slug}`,
  };
}

async function cf<T>(
  path: string,
  opts: { method?: "GET" | "POST"; body?: unknown; nullOn404?: boolean } = {},
): Promise<T | null> {
  const root = base();
  if (!root) return null;
  const { curseforgeApiKey } = getProviderConfig();
  const res = await request<{ data: T }>(`${root}${path}`, {
    provider: P,
    headers: curseforgeApiKey ? { "x-api-key": curseforgeApiKey } : undefined,
    ...opts,
  });
  return res ? res.data : null;
}

export const curseforge = {
  available: () => base() !== null,

  /** Verifie que le proxy repond et relaie bien vers CurseForge. */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const root = base();
    if (!root) return { ok: false, message: "Aucune URL de proxy renseignee." };
    try {
      const m = await cf<CfMod>("/v1/mods/238222", { nullOn404: true });
      if (!m) return { ok: false, message: "Le proxy repond mais ne renvoie pas de donnees." };
      return { ok: true, message: `Connecte — projet test reconnu : ${m.name}.` };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Echec de la connexion.",
      };
    }
  },

  async getProject(id: string): Promise<ProviderProject | null> {
    const m = await cf<CfMod>(`/v1/mods/${id}`, { nullOn404: true });
    return m ? toProject(m) : null;
  },

  async getProjects(ids: string[]): Promise<ProviderProject[]> {
    if (!base()) return [];
    const out: ProviderProject[] = [];
    for (const batch of chunk([...new Set(ids)], 100)) {
      const res = await cf<CfMod[]>("/v1/mods", {
        method: "POST",
        body: { modIds: batch.map(Number).filter(Number.isFinite) },
      });
      if (res) out.push(...res.map(toProject));
    }
    return out;
  },

  async getVersions(
    id: string,
    loaders: string[],
    gameVersions: string[],
  ): Promise<ProviderVersion[]> {
    if (!base()) return [];
    const results: ProviderVersion[] = [];
    const types = loaders.map((l) => LOADER_TYPE[l]).filter((n): n is number => n !== undefined);

    for (const gv of gameVersions.length ? gameVersions : [""]) {
      for (const lt of types.length ? types : [0]) {
        const qs = new URLSearchParams({ pageSize: "50" });
        if (gv) qs.set("gameVersion", gv);
        if (lt) qs.set("modLoaderType", String(lt));
        const files = await cf<CfFile[]>(`/v1/mods/${id}/files?${qs}`, { nullOn404: true });
        if (files) results.push(...files.map(toVersion));
      }
    }
    const seen = new Set<string>();
    return results.filter((v) => (seen.has(v.versionId) ? false : (seen.add(v.versionId), true)));
  },

  async getFiles(fileIds: string[]): Promise<ProviderVersion[]> {
    if (!base()) return [];
    const out: ProviderVersion[] = [];
    for (const batch of chunk([...new Set(fileIds)], 100)) {
      const res = await cf<CfFile[]>("/v1/mods/files", {
        method: "POST",
        body: { fileIds: batch.map(Number).filter(Number.isFinite) },
      });
      if (res) out.push(...res.map(toVersion));
    }
    return out;
  },

  async lookupByFingerprints(fingerprints: number[]): Promise<Map<number, ProviderVersion>> {
    const map = new Map<number, ProviderVersion>();
    if (!base() || !fingerprints.length) return map;
    for (const batch of chunk([...new Set(fingerprints)], 200)) {
      const res = await cf<{ exactMatches: { id: number; file: CfFile }[] }>("/v1/fingerprints", {
        method: "POST",
        body: { fingerprints: batch },
      });
      for (const m of res?.exactMatches ?? []) {
        const fp = m.file?.fileFingerprint;
        if (typeof fp === "number") map.set(fp, toVersion(m.file));
      }
    }
    return map;
  },

  async search(
    query: string,
    loaders: string[],
    gameVersion: string,
    limit = 20,
  ): Promise<ProviderProject[]> {
    if (!base()) return [];
    const qs = new URLSearchParams({
      gameId: String(GAME_ID),
      classId: String(CLASS_MODS),
      searchFilter: query,
      sortField: "2",
      sortOrder: "desc",
      pageSize: String(limit),
    });
    if (gameVersion) qs.set("gameVersion", gameVersion);
    const lt = LOADER_TYPE[loaders[0] ?? ""];
    if (lt) qs.set("modLoaderType", String(lt));
    const res = await cf<CfMod[]>(`/v1/mods/search?${qs}`);
    return (res ?? []).map(toProject);
  },
};
