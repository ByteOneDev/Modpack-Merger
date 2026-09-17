"use client";

import { get, set, del, keys } from "idb-keyval";

/**
 * Conservation des archives envoyees.
 *
 * Elles ne quittent jamais la machine : il n'y a pas de serveur. On les garde
 * dans IndexedDB pour qu'un rechargement de page ne fasse pas perdre le
 * travail en cours — un modpack fait souvent plusieurs centaines de Mo, le
 * reuploader serait penible.
 */

const PREFIX = "modpack-merger.archive.";

export async function saveArchive(packId: string, data: Blob): Promise<void> {
  await set(PREFIX + packId, data);
}

export async function loadArchive(packId: string): Promise<Uint8Array | null> {
  const blob = await get<Blob>(PREFIX + packId);
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

export async function dropArchive(packId: string): Promise<void> {
  await del(PREFIX + packId);
}

export async function dropAllArchives(): Promise<void> {
  const all = await keys();
  await Promise.all(
    all
      .filter((k): k is string => typeof k === "string" && k.startsWith(PREFIX))
      .map((k) => del(k)),
  );
}

/** Taille totale occupee, pour l'afficher dans les reglages. */
export async function archivesFootprint(): Promise<number> {
  const all = await keys();
  let total = 0;
  for (const k of all) {
    if (typeof k !== "string" || !k.startsWith(PREFIX)) continue;
    const blob = await get<Blob>(k);
    if (blob) total += blob.size;
  }
  return total;
}
