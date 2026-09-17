import type { LoaderId } from "@/lib/core/types";

/**
 * Derniere version stable de chaque mod loader pour une version de Minecraft.
 * Chaque loader publie ses metadonnees a un endroit different et dans un
 * format different, d'ou les quatre implementations.
 */

const cache = new Map<string, { at: number; value: string | null }>();
const TTL = 30 * 60 * 1000;

async function get(url: string, json = true): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return json ? res.json() : res.text();
}

/** NeoForge indexe ses versions sur la version de Minecraft sans le "1." initial. */
function neoforgePrefix(mc: string): string {
  return mc.startsWith("1.") ? mc.slice(2) : mc;
}

async function fetchLoaderVersion(
  loader: LoaderId,
  mc: string,
): Promise<string | null> {
  switch (loader) {
    case "fabric": {
      const d = (await get("https://meta.fabricmc.net/v2/versions/loader")) as {
        version: string;
        stable: boolean;
      }[];
      return d.find((v) => v.stable)?.version ?? d[0]?.version ?? null;
    }
    case "quilt": {
      const d = (await get("https://meta.quiltmc.org/v3/versions/loader")) as {
        version: string;
      }[];
      // Quilt ne marque pas ses versions comme stables : on ecarte les beta
      // s'il existe au moins une version sans suffixe.
      const stable = d.find((v) => !/-(beta|rc|pre)/i.test(v.version));
      return stable?.version ?? d[0]?.version ?? null;
    }
    case "neoforge": {
      const xml = (await get(
        "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml",
        false,
      )) as string;
      const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
      const prefix = neoforgePrefix(mc);
      const matching = all.filter((v) => v.startsWith(prefix + "."));
      const stable = matching.filter((v) => !/-(beta|alpha|rc)/i.test(v));
      return stable.at(-1) ?? matching.at(-1) ?? null;
    }
    case "forge": {
      const d = (await get(
        "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
      )) as { promos: Record<string, string> };
      return d.promos[`${mc}-recommended`] ?? d.promos[`${mc}-latest`] ?? null;
    }
  }
}

export async function latestLoaderVersion(
  loader: LoaderId,
  mc: string,
): Promise<string | null> {
  const key = `${loader}:${mc}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  let value: string | null = null;
  try {
    value = await fetchLoaderVersion(loader, mc);
  } catch {
    value = null;
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Nom de la cle attendue dans modrinth.index.json. */
export const MRPACK_LOADER_KEY: Record<LoaderId, string> = {
  fabric: "fabric-loader",
  quilt: "quilt-loader",
  forge: "forge",
  neoforge: "neoforge",
};
