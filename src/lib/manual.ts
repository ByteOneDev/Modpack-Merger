"use client";

import { get, set, del, keys } from "idb-keyval";
import { sha1 } from "@/lib/core/hash";
import { normalizeTitle } from "@/lib/core/providers";
import { CONTENT_INFO } from "@/lib/core/content";
import type { ModResolution } from "@/lib/core/types";

/**
 * Fichiers recuperes a la main.
 *
 * Certains auteurs interdisent la distribution de leur mod par des tiers :
 * l'API renvoie alors le fichier sans lien de telechargement. Aucun outil ne
 * peut contourner cela sans passer outre leur choix — Prism Launcher ouvre la
 * page et attend le fichier, c'est la meme approche ici.
 *
 * Le navigateur n'a pas acces au dossier Telechargements de lui-meme. Deux
 * chemins existent : l'utilisateur depose les fichiers, ou il autorise une
 * fois pour toutes la lecture d'un dossier via l'API File System Access, et
 * l'outil le relit ensuite tout seul.
 */

const PREFIX = "modpack-merger.manual.";
const DIR_HANDLE_KEY = "modpack-merger.manual-dir";

export interface ManualFileInfo {
  fileName: string;
  size: number;
  sha1: string;
  /** true si l'empreinte correspond exactement a celle attendue */
  verified: boolean;
}

export interface PendingDownload {
  key: string;
  name: string;
  fileName: string;
  /** page exacte du fichier a telecharger */
  pageUrl: string;
  /** libelle lisible du type, ex. "resource pack" */
  kind: string;
  folder: string;
  expectedSha1?: string;
  fileSize?: number;
  /** motif : l'auteur refuse la distribution, ou le telechargement a echoue */
  reason: "distribution" | "echec";
}

/**
 * Contenus qui ne peuvent pas etre telecharges automatiquement.
 *
 * `failedKeys` provient d'un export precedent : un CDN qui refuse la requete
 * produit le meme besoin qu'un refus de distribution.
 */
export function pendingDownloads(
  resolutions: ModResolution[],
  have: Record<string, ManualFileInfo>,
  failedKeys: Set<string> = new Set(),
): PendingDownload[] {
  const out: PendingDownload[] = [];

  for (const r of resolutions) {
    if (r.status !== "ok" && r.status !== "substituted") continue;
    const v = r.picked;
    if (!v) continue;
    if (have[r.key]) continue;

    const blocked = v.manualOnly === true || !v.downloadUrl;
    if (!blocked && !failedKeys.has(r.key)) continue;

    out.push({
      key: r.key,
      name: r.name,
      fileName: v.fileName,
      pageUrl: v.pageUrl ?? r.project?.url ?? "",
      kind: CONTENT_INFO[r.kind].label,
      folder: CONTENT_INFO[r.kind].folder,
      expectedSha1: v.hashes.sha1,
      fileSize: v.fileSize,
      reason: blocked ? "distribution" : "echec",
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Appariement fichier -> contenu attendu                              */
/* ------------------------------------------------------------------ */

export interface MatchResult {
  key: string;
  info: ManualFileInfo;
  /** comment l'appariement a ete etabli, pour pouvoir le montrer */
  how: "empreinte" | "nom exact" | "nom approchant";
}

/**
 * Rapproche des fichiers deposes des telechargements attendus.
 *
 * L'empreinte prime : c'est la seule preuve que le fichier est bien la
 * version voulue et pas une autre trouvee au hasard dans le dossier. Le nom
 * ne sert que de repli, parce que les deux plateformes le changent parfois.
 */
export async function matchFiles(
  files: { name: string; bytes: Uint8Array }[],
  pending: PendingDownload[],
): Promise<{ matched: MatchResult[]; unmatched: string[] }> {
  const matched: MatchResult[] = [];
  const unmatched: string[] = [];
  const taken = new Set<string>();

  const bySha = new Map<string, PendingDownload>();
  for (const p of pending) if (p.expectedSha1) bySha.set(p.expectedSha1.toLowerCase(), p);

  for (const file of files) {
    const digest = sha1(file.bytes);
    const lower = file.name.toLowerCase();

    let hit = bySha.get(digest);
    let how: MatchResult["how"] = "empreinte";

    if (!hit || taken.has(hit.key)) {
      hit = pending.find((p) => !taken.has(p.key) && p.fileName.toLowerCase() === lower);
      how = "nom exact";
    }
    if (!hit) {
      const wanted = normalizeTitle(file.name.replace(/\.[a-z0-9]+$/i, ""));
      hit =
        wanted.length >= 4
          ? pending.find(
              (p) =>
                !taken.has(p.key) &&
                (normalizeTitle(p.fileName.replace(/\.[a-z0-9]+$/i, "")).includes(wanted) ||
                  wanted.includes(normalizeTitle(p.name))),
            )
          : undefined;
      how = "nom approchant";
    }

    if (!hit) {
      unmatched.push(file.name);
      continue;
    }

    taken.add(hit.key);
    await set(PREFIX + hit.key, new Blob([file.bytes as BlobPart]));
    matched.push({
      key: hit.key,
      how,
      info: {
        fileName: file.name,
        size: file.bytes.length,
        sha1: digest,
        verified: !!hit.expectedSha1 && hit.expectedSha1.toLowerCase() === digest,
      },
    });
  }

  return { matched, unmatched };
}

/* ------------------------------------------------------------------ */
/* Stockage                                                            */
/* ------------------------------------------------------------------ */

/** Range un fichier fourni par l'utilisateur, hors du state React. */
export async function storeManualFile(key: string, bytes: Uint8Array): Promise<void> {
  await set(PREFIX + key, new Blob([bytes as BlobPart]));
}

export async function loadManualFile(key: string): Promise<Uint8Array | null> {
  const blob = await get<Blob>(PREFIX + key).catch(() => null);
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

export async function loadManualFiles(keys: string[]): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const k of keys) {
    const data = await loadManualFile(k);
    if (data) out.set(k, data);
  }
  return out;
}

export async function dropManualFile(key: string): Promise<void> {
  await del(PREFIX + key).catch(() => {});
}

export async function dropAllManualFiles(): Promise<void> {
  const all = await keys().catch(() => []);
  await Promise.all(
    all
      .filter((k): k is string => typeof k === "string" && k.startsWith(PREFIX))
      .map((k) => del(k).catch(() => {})),
  );
}

/* ------------------------------------------------------------------ */
/* Lecture automatique d'un dossier (Chrome, Edge, Opera)              */
/* ------------------------------------------------------------------ */

interface FileSystemDirectoryHandleLike {
  name: string;
  values: () => AsyncIterableIterator<{
    kind: "file" | "directory";
    name: string;
    getFile: () => Promise<File>;
  }>;
  queryPermission?: (d: { mode: string }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: string }) => Promise<PermissionState>;
}

type PickerWindow = Window & {
  showDirectoryPicker?: (o?: { mode?: string; id?: string; startIn?: string }) => Promise<FileSystemDirectoryHandleLike>;
};

/** L'API de lecture de dossier n'existe pas sur Firefox ni Safari. */
export function canWatchFolder(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/**
 * Demande l'acces a un dossier et le retient.
 *
 * L'autorisation est donnee par l'utilisateur dans une fenetre du systeme :
 * une page web ne peut pas atteindre un dossier autrement, et surtout pas le
 * dossier Telechargements de sa propre initiative.
 */
export async function chooseFolder(): Promise<string | null> {
  const w = window as PickerWindow;
  if (!w.showDirectoryPicker) return null;
  try {
    const handle = await w.showDirectoryPicker({
      mode: "read",
      id: "modpack-merger-downloads",
      startIn: "downloads",
    });
    await set(DIR_HANDLE_KEY, handle);
    return handle.name;
  } catch {
    return null; // l'utilisateur a annule
  }
}

export async function watchedFolderName(): Promise<string | null> {
  const handle = await get<FileSystemDirectoryHandleLike>(DIR_HANDLE_KEY).catch(() => null);
  return handle?.name ?? null;
}

export async function forgetFolder(): Promise<void> {
  await del(DIR_HANDLE_KEY).catch(() => {});
}

/**
 * Relit le dossier autorise et ne remonte que les fichiers attendus.
 *
 * On ne lit pas le dossier entier : seuls les fichiers dont l'extension
 * correspond a ce qui manque sont ouverts, et le reste n'est jamais touche.
 */
export async function scanFolder(
  pending: PendingDownload[],
): Promise<{ files: { name: string; bytes: Uint8Array }[]; denied: boolean }> {
  const handle = await get<FileSystemDirectoryHandleLike>(DIR_HANDLE_KEY).catch(() => null);
  if (!handle) return { files: [], denied: true };

  if (handle.queryPermission) {
    let state = await handle.queryPermission({ mode: "read" });
    if (state === "prompt" && handle.requestPermission) {
      state = await handle.requestPermission({ mode: "read" });
    }
    if (state !== "granted") return { files: [], denied: true };
  }

  const wantedExt = new Set(
    pending.map((p) => (p.fileName.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jar").toLowerCase()),
  );
  const wantedNames = new Set(pending.map((p) => p.fileName.toLowerCase()));

  const out: { name: string; bytes: Uint8Array }[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== "file") continue;
    const lower = entry.name.toLowerCase();
    const ext = lower.match(/\.[a-z0-9]+$/)?.[0] ?? "";
    // Nom exact attendu, ou bonne extension : on evite d'ouvrir des fichiers
    // personnels qui n'ont rien a voir avec le pack.
    if (!wantedNames.has(lower) && !wantedExt.has(ext)) continue;
    try {
      const file = await entry.getFile();
      if (file.size > 400 * 1024 * 1024) continue;
      out.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    } catch {
      /* fichier illisible ou en cours d'ecriture : ignore */
    }
  }

  return { files: out, denied: false };
}
