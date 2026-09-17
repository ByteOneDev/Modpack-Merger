"use client";

import { setProviderConfig } from "@/lib/core/providers/config";

/**
 * Detection du relais servi par l'hebergement.
 *
 * L'app est un export statique. Selon l'endroit ou elle est deposee, elle
 * dispose ou non d'une petite couche serveur :
 *
 *  - GitHub Pages : fichiers statiques uniquement, aucun relais ;
 *  - Cloudflare Pages, Netlify, Vercel : les fichiers de `functions/` sont
 *    executes en plus du statique, le relais repond sous /api/.
 *
 * On ne le devine pas, on le demande : une requete au demarrage tranche.
 */

export type RelayStatus =
  | { kind: "none" }                       // pas de couche serveur
  | { kind: "unconfigured"; message: string } // relais present, cle absente
  | { kind: "ready" };                     // relais operationnel

const BASE = "/api/curseforge";
const DOWNLOAD = "/api/download";

/** Projet public stable, utilise comme requete temoin (JEI). */
const PROBE = `${BASE}/v1/mods/238222`;

let cached: RelayStatus | null = null;

export async function detectRelay(): Promise<RelayStatus> {
  if (cached) return cached;

  let status: RelayStatus = { kind: "none" };
  try {
    const res = await fetch(PROBE, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    // Un hebergement statique renvoie sa page 404 en HTML : le type de
    // contenu suffit a distinguer "pas de relais" de "relais qui repond".
    const isJson = (res.headers.get("content-type") ?? "").includes("application/json");

    if (isJson && res.ok) {
      status = { kind: "ready" };
    } else if (isJson && res.status === 503) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      status = {
        kind: "unconfigured",
        message: body?.error ?? "Relais present mais sans cle API.",
      };
    }
  } catch {
    status = { kind: "none" };
  }

  if (status.kind === "ready") {
    setProviderConfig({ builtInProxyUrl: BASE, downloadProxyUrl: DOWNLOAD });
  }

  cached = status;
  return status;
}

/** Force une nouvelle detection, apres un changement de reglages. */
export function resetRelayDetection(): void {
  cached = null;
}
