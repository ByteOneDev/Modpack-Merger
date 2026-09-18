"use client";

import type { ZipSink } from "@/lib/core/zip";

/**
 * Destination d'enregistrement de l'archive.
 *
 * Deux chemins, selon le navigateur :
 *
 * - avec l'API File System Access (Chrome, Edge, Opera), l'utilisateur choisit
 *   le fichier avant la generation et les octets y sont ecrits au fil de
 *   l'eau. Rien n'est detenu, donc aucune limite de taille propre a l'onglet ;
 * - sinon, l'archive est assemblee en Blob puis telechargee. Cela fonctionne,
 *   mais le stockage de Blobs du navigateur a son propre plafond : un pack
 *   complet de plusieurs Go peut s'y heurter.
 */

interface WritableLike {
  write: (data: BufferSource | Blob) => Promise<void>;
  close: () => Promise<void>;
  abort?: () => Promise<void>;
}

interface SaveHandleLike {
  name: string;
  createWritable: () => Promise<WritableLike>;
}

type SaveWindow = Window & {
  showSaveFilePicker?: (o?: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<SaveHandleLike>;
};

export function canStreamToDisk(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

/**
 * Demande ou ecrire, puis renvoie de quoi y ecrire en flux.
 * Renvoie null si l'utilisateur annule ou si le navigateur ne sait pas faire.
 */
export async function askWhereToSave(
  suggestedName: string,
): Promise<{ sink: ZipSink; name: string } | null> {
  const w = window as SaveWindow;
  if (!w.showSaveFilePicker) return null;

  const ext = suggestedName.endsWith(".mrpack") ? ".mrpack" : ".zip";
  let handle: SaveHandleLike;
  try {
    handle = await w.showSaveFilePicker({
      suggestedName,
      types: [
        {
          description: ext === ".mrpack" ? "Modpack Modrinth" : "Archive de modpack",
          accept: { "application/zip": [ext] },
        },
      ],
    });
  } catch {
    return null; // annulation
  }

  const writable = await handle.createWritable();
  return {
    name: handle.name,
    sink: {
      write: (chunk) => writable.write(chunk as BufferSource),
      close: () => writable.close(),
      abort: () => writable.abort?.() ?? Promise.resolve(),
    },
  };
}

/** Telechargement classique, quand l'archive tient dans un Blob. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  // Revocation differee : Safari annule un telechargement dont l'URL
  // disparait dans la foulee du clic.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
