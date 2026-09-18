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

/** Base et magasin utilises par idb-keyval, pour pouvoir les reparer. */
const BASE = "keyval-store";
const MAGASIN = "keyval";

/**
 * Copie de secours, le temps de la session.
 *
 * IndexedDB peut refuser d'ecrire : navigation privee, quota depasse — un
 * modpack complet pese facilement 900 Mo. Perdre le pack pour autant serait
 * excessif : on garde le Blob, qui est gere par le navigateur et ne coute
 * presque rien en memoire. Seule la survie a un rechargement est perdue.
 */
const enSession = new Map<string, Blob>();

/** @returns false si l'archive n'a pu etre gardee que pour cette session. */
export async function saveArchive(packId: string, data: Blob): Promise<boolean> {
  enSession.set(PREFIX + packId, data);
  try {
    await set(PREFIX + packId, data);
    return true;
  } catch {
    return false;
  }
}

export async function loadArchive(packId: string): Promise<Uint8Array | null> {
  const blob =
    enSession.get(PREFIX + packId) ??
    (await get<Blob>(PREFIX + packId).catch(() => null));
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

export async function dropArchive(packId: string): Promise<void> {
  enSession.delete(PREFIX + packId);
  await del(PREFIX + packId).catch(() => {});
}

export async function dropAllArchives(): Promise<void> {
  enSession.clear();
  const all = await keys().catch(() => []);
  await Promise.all(
    all
      .filter((k): k is string => typeof k === "string" && k.startsWith(PREFIX))
      .map((k) => del(k)),
  );
}

/**
 * Repare une base laissee dans un etat inutilisable.
 *
 * IndexedDB peut se retrouver avec la base presente mais sans son magasin :
 * une suppression concurrente, un onglet qui la tenait ouverte, un plantage
 * du navigateur au mauvais moment. Toute ecriture echoue alors sur « object
 * store not found », definitivement — rien ne se repare tout seul et
 * l'utilisateur n'a aucun moyen de s'en sortir depuis l'app.
 *
 * On verifie donc au demarrage, et on efface la base si elle est cassee :
 * idb-keyval la recreera proprement. Le seul cout est la perte d'une session
 * de toute facon deja inutilisable.
 */
export async function reparerStockage(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;

  const etat = await new Promise<"ok" | "cassee" | "indisponible">((resolve) => {
    let repondu = false;
    const fini = (v: "ok" | "cassee" | "indisponible") => {
      if (!repondu) {
        repondu = true;
        resolve(v);
      }
    };
    const demande = indexedDB.open(BASE);
    demande.onsuccess = () => {
      const db = demande.result;
      const complet = db.objectStoreNames.contains(MAGASIN);
      db.close();
      fini(complet ? "ok" : "cassee");
    };
    demande.onerror = () => fini("indisponible");
    demande.onblocked = () => fini("indisponible");
    setTimeout(() => fini("indisponible"), 4000);
  });

  if (etat !== "cassee") return false;

  await new Promise<void>((resolve) => {
    const suppression = indexedDB.deleteDatabase(BASE);
    suppression.onsuccess = () => resolve();
    suppression.onerror = () => resolve();
    suppression.onblocked = () => resolve();
    setTimeout(resolve, 4000);
  });
  return true;
}

/**
 * Taille totale occupee, pour l'afficher dans les reglages.
 *
 * Les fichiers recuperes a la main comptent aussi : ils vivent dans le meme
 * stockage et sont effaces par le meme bouton, les omettre donnerait un
 * chiffre faux.
 */
export async function archivesFootprint(): Promise<number> {
  const all = await keys().catch(() => []);
  let total = 0;
  for (const k of all) {
    if (typeof k !== "string") continue;
    if (!k.startsWith(PREFIX) && !k.startsWith("modpack-merger.manual.")) continue;
    const blob = await get<Blob>(k);
    if (blob) total += blob.size;
  }
  return total;
}
