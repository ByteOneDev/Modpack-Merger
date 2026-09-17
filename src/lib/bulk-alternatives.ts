"use client";

import { findAlternatives } from "@/lib/core/merge/alternatives";
import type { Alternative, MergeTarget, ModResolution } from "@/lib/core/types";

/**
 * Recherche d'alternatives pour tous les mods introuvables d'un coup.
 *
 * Chaque mod coute une dizaine de requetes (equivalences curees, recherche
 * sur les deux plateformes, puis verification qu'une version installable
 * existe). Sur un pack ou des centaines de mods manquent, cela se compte en
 * minutes : le traitement est donc incrementiel, interruptible, et ce qui a
 * deja ete trouve reste acquis si l'utilisateur arrete.
 */

export interface BulkSuggestion {
  key: string;
  modName: string;
  /** meilleure proposition, ou null si rien d'installable n'existe */
  best: Alternative | null;
  /** autres propositions, pour changer d'avis */
  others: Alternative[];
  note: string | null;
  /** coche par defaut : on ne preselectionne pas un fork en silence */
  selected: boolean;
}

export interface BulkProgress {
  done: number;
  total: number;
  current: string;
  found: number;
}

export interface BulkHandle {
  /** demande l'arret ; la promesse se resout avec ce qui a ete trouve */
  cancel: () => void;
  results: Promise<BulkSuggestion[]>;
}

/** Nombre de mods traites en parallele. Volontairement bas : les APIs
 *  publiques limitent le debit, et chaque mod emet deja plusieurs requetes. */
const MOD_CONCURRENCY = 3;

/** Propositions conservees par mod : au-dela, c'est du temps perdu. */
const PER_MOD_LIMIT = 4;

export function findAlternativesForAll(
  missing: ModResolution[],
  target: MergeTarget,
  onProgress: (p: BulkProgress) => void,
): BulkHandle {
  let cancelled = false;
  const out: BulkSuggestion[] = [];
  let done = 0;
  let found = 0;
  let cursor = 0;

  async function worker() {
    for (;;) {
      if (cancelled) return;
      const i = cursor++;
      if (i >= missing.length) return;

      const mod = missing[i];
      onProgress({ done, total: missing.length, current: mod.name, found });

      try {
        const { alternatives, note } = await findAlternatives(mod, target, PER_MOD_LIMIT);
        const best = alternatives[0] ?? null;
        if (best) found++;
        out.push({
          key: mod.key,
          modName: mod.name,
          best,
          others: alternatives.slice(1),
          note,
          // Un fork ou une version instable demande un choix conscient :
          // on le propose mais on ne le coche pas d'office.
          selected: !!best && !best.isFork && best.version.versionType === "release",
        });
      } catch {
        out.push({
          key: mod.key,
          modName: mod.name,
          best: null,
          others: [],
          note: "La recherche a echoue pour ce mod.",
          selected: false,
        });
      }

      done++;
      onProgress({ done, total: missing.length, current: mod.name, found });
    }
  }

  const results = (async () => {
    await Promise.all(
      Array.from({ length: Math.min(MOD_CONCURRENCY, missing.length) }, worker),
    );
    // Remis dans l'ordre d'affichage d'origine, que le parallelisme perturbe
    const order = new Map(missing.map((m, i) => [m.key, i]));
    return out.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
  })();

  return {
    cancel: () => {
      cancelled = true;
    },
    results,
  };
}

/** Estimation grossiere du temps restant, pour ne pas laisser l'utilisateur
 *  devant une barre qui avance sans indication. */
export function estimateRemaining(p: BulkProgress, startedAt: number): string {
  if (p.done === 0) return "estimation en cours…";
  const elapsed = Date.now() - startedAt;
  const perItem = elapsed / p.done;
  const remaining = Math.round((perItem * (p.total - p.done)) / 1000);
  if (remaining < 60) return `environ ${remaining} s restantes`;
  const min = Math.round(remaining / 60);
  return `environ ${min} min restante${min > 1 ? "s" : ""}`;
}
