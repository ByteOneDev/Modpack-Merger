"use client";

import { strFromU8 } from "fflate";
import { loadArchive } from "@/lib/archives";
import { readZip, looksBinary } from "@/lib/core/zip";
import { bytesEqual } from "@/lib/core/hash";
import { applyDecision, type OverrideSide } from "@/lib/core/merge/overrides";
import type { OverrideDecision, ParsedPack } from "@/lib/core/types";

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

/* ------------------------------------------------------------------ */
/* Contenu final d'un fichier, pour l'editeur                           */
/* ------------------------------------------------------------------ */

/**
 * Archives recemment relues, gardees le temps d'editer quelques fichiers :
 * relire un pack de plusieurs centaines de Mo a chaque fichier ouvert
 * rendrait l'editeur penible. Le plafond evite de garder plusieurs Go.
 */
const archives = new Map<string, Uint8Array>();
const ARCHIVE_CACHE_BYTES = 512 * 1024 * 1024;

async function cachedArchive(packId: string): Promise<Uint8Array | null> {
  const hit = archives.get(packId);
  if (hit) return hit;
  const buf = await loadArchive(packId);
  if (!buf) return null;
  let total = buf.length;
  for (const b of archives.values()) total += b.length;
  for (const [id, b] of archives) {
    if (total <= ARCHIVE_CACHE_BYTES) break;
    archives.delete(id);
    total -= b.length;
  }
  if (buf.length <= ARCHIVE_CACHE_BYTES) archives.set(packId, buf);
  return buf;
}

export interface FinalFile {
  /** null si le fichier est binaire, trop gros, ou exclu par la decision */
  text: string | null;
  size: number;
  /** etiquettes des packs qui fournissent ce fichier */
  from: string[];
}

/**
 * Contenu tel qu'il partira dans l'archive : la version retenue, ou le
 * resultat de la fusion quand plusieurs packs fournissent le fichier.
 */
export async function loadFinalFile(
  packs: ParsedPack[],
  dest: string,
  decision: OverrideDecision | undefined,
): Promise<FinalFile | null> {
  const sides: OverrideSide[] = [];
  for (const pack of packs) {
    if (!pack.overridePaths.includes(dest)) continue;
    const buf = await cachedArchive(pack.id);
    if (!buf) continue;
    const path = archivePath(pack, dest);
    const data = readZip(buf, (p) => p === path)[path];
    if (data) sides.push({ packId: pack.id, label: pack.label, data });
  }
  if (!sides.length) return null;

  let data: Uint8Array | null = sides[0].data;
  if (sides.length > 1 && !sides.every((s) => bytesEqual(s.data, sides[0].data))) {
    const out = applyDecision(dest, sides, decision ?? sides[0].packId);
    data = out.find((f) => f.path === dest)?.data ?? null;
  }

  const from = sides.map((s) => s.label);
  if (!data) return { text: null, size: 0, from };
  const lisible = data.length <= MAX_PREVIEW && !looksBinary(data);
  return { text: lisible ? strFromU8(data) : null, size: data.length, from };
}

/** Extensions des fichiers qu'un editeur de texte peut ouvrir sans risque. */
const EDITABLE = /\.(json|json5|jsonc|toml|cfg|conf|properties|ini|txt|yml|yaml|js|zs|snbt|mcmeta|md)$/i;

/** Fichiers d'instance modifiables, tous packs confondus. */
export function editableFiles(packs: ParsedPack[]): { path: string; from: string[] }[] {
  const byPath = new Map<string, string[]>();
  for (const pack of packs) {
    for (const path of pack.overridePaths) {
      if (!EDITABLE.test(path) || /(^|\/)(saves|logs|crash-reports)\//i.test(path)) continue;
      byPath.set(path, [...(byPath.get(path) ?? []), pack.label]);
    }
  }
  return [...byPath.entries()]
    .map(([path, from]) => ({ path, from }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
