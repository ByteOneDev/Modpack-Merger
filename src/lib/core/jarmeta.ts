import { parse as parseToml } from "smol-toml";
import { readZip, readJson, readText } from "./zip";
import type { LoaderId } from "@/lib/core/types";

export interface JarMeta {
  modId?: string;
  name?: string;
  version?: string;
  loaders: LoaderId[];
  /** ids des dependances declarees dans le jar */
  depends: string[];
}

/**
 * Lit les metadonnees d'un jar de mod. Sert de repli quand ni le hash ni
 * le manifeste ne permettent d'identifier le mod (jars edites a la main,
 * mods non publies, builds de dev).
 */
export function readJarMeta(jar: Uint8Array): JarMeta | null {
  let entries;
  try {
    entries = readZip(jar);
  } catch {
    return null;
  }

  // Fabric
  const fabric = readJson<{
    id?: string;
    name?: string;
    version?: string;
    depends?: Record<string, unknown>;
  }>(entries, "fabric.mod.json");
  if (fabric?.id) {
    return {
      modId: fabric.id,
      name: fabric.name,
      version: fabric.version,
      loaders: ["fabric"],
      depends: Object.keys(fabric.depends ?? {}),
    };
  }

  // Quilt
  const quilt = readJson<{
    quilt_loader?: {
      id?: string;
      version?: string;
      metadata?: { name?: string };
      depends?: { id?: string }[];
    };
  }>(entries, "quilt.mod.json");
  if (quilt?.quilt_loader?.id) {
    return {
      modId: quilt.quilt_loader.id,
      name: quilt.quilt_loader.metadata?.name,
      version: quilt.quilt_loader.version,
      loaders: ["quilt"],
      depends: (quilt.quilt_loader.depends ?? [])
        .map((d) => d.id)
        .filter((id): id is string => !!id),
    };
  }

  // NeoForge puis Forge (meme schema TOML)
  for (const [path, loader] of [
    ["META-INF/neoforge.mods.toml", "neoforge"],
    ["META-INF/mods.toml", "forge"],
  ] as const) {
    const text = readText(entries, path);
    if (!text) continue;
    try {
      const toml = parseToml(text) as {
        mods?: { modId?: string; displayName?: string; version?: string }[];
        dependencies?: Record<string, { modId?: string }[]>;
      };
      const first = toml.mods?.[0];
      if (!first?.modId) continue;
      const depends = Object.values(toml.dependencies ?? {})
        .flat()
        .map((d) => d?.modId)
        .filter((id): id is string => !!id);
      return {
        modId: first.modId,
        name: first.displayName,
        version: first.version,
        // mods.toml existe aussi dans des jars NeoForge recents
        loaders: loader === "forge" ? ["forge", "neoforge"] : ["neoforge"],
        depends,
      };
    } catch {
      /* TOML invalide : on continue */
    }
  }

  return null;
}

/** Devine un nom lisible depuis un nom de fichier jar. */
export function nameFromFileName(fileName: string): string {
  return fileName
    .replace(/\.jar$/i, "")
    .replace(/[-_+](mc)?\d+(\.\d+)*.*$/i, "")
    .replace(/[-_]/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || fileName;
}
