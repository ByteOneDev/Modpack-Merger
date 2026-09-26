"use client";

import { strFromU8 } from "fflate";
import { loadArchive } from "@/lib/archives";
import { readZip, looksBinary } from "@/lib/core/zip";
import type { ParsedPack } from "@/lib/core/types";

/**
 * Contenu des versions d'un fichier en conflit, lu a la demande.
 *
 * Le contenu n'est pas garde dans l'etat : il y en a souvent des centaines,
 * et l'etat est ecrit dans IndexedDB a chaque changement. On relit donc
 * l'entree voulue, et elle seule, quand l'utilisateur demande l'apercu.
 */

export interface SideContent {
  packId: string;
  /** null si le fichier est binaire ou trop gros pour un apercu */
  text: string | null;
  size: number;
}

const MAX_PREVIEW = 512 * 1024;

/** Chemin dans l'archive d'origine d'un chemin de destination. */
function archivePath(pack: ParsedPack, dest: string): string {
  if (pack.format !== "raw") return dest;
  return (pack.rootPrefix ?? "") + dest.replace(/^overrides\//, "");
}

const cache = new Map<string, SideContent[]>();

export async function loadConflictSides(
  packs: ParsedPack[],
  dest: string,
  packIds: string[],
): Promise<SideContent[]> {
  const cacheKey = `${dest}\n${packIds.join(",")}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const out: SideContent[] = [];
  for (const id of packIds) {
    const pack = packs.find((p) => p.id === id);
    const buf = pack ? await loadArchive(pack.id) : null;
    if (!pack || !buf) {
      out.push({ packId: id, text: null, size: 0 });
      continue;
    }
    const path = archivePath(pack, dest);
    const data = readZip(buf, (p) => p === path)[path];
    if (!data) {
      out.push({ packId: id, text: null, size: 0 });
      continue;
    }
    const lisible = data.length <= MAX_PREVIEW && !looksBinary(data);
    out.push({ packId: id, text: lisible ? strFromU8(data) : null, size: data.length });
  }

  if (cache.size > 20) cache.clear();
  cache.set(cacheKey, out);
  return out;
}
