"use client";

import { CONTENT_INFO } from "@/lib/core/content";
import { pendingDownloads, type ManualFileInfo } from "@/lib/manual";
import type { ExportFormat } from "@/lib/core/build";
import type { ModResolution } from "@/lib/core/types";
import type { MergeState } from "@/lib/store";

/**
 * Conditions a remplir avant de generer le pack.
 *
 * Un modpack incomplet ne se voit pas : l'archive s'ouvre, s'installe, et le
 * jeu plante ou se connecte mal des semaines plus tard. Mieux vaut refuser de
 * produire le fichier que d'en livrer un auquel il manque des morceaux.
 *
 * Rien n'est contourne en silence : chaque obstacle a une action qui le leve,
 * y compris « ecarter definitivement », qui est une decision assumee et
 * consignee dans le rapport.
 */

export type BlockerKind = "missing" | "manual" | "failed";

export interface Blocker {
  kind: BlockerKind;
  key: string;
  name: string;
  /** ce qui manque, en une phrase */
  detail: string;
}

export interface Readiness {
  ready: boolean;
  blockers: Blocker[];
  /** regroupement pour l'affichage */
  missing: Blocker[];
  manual: Blocker[];
  failed: Blocker[];
  /** problemes serieux qui n'empechent pas de generer */
  warnings: string[];
}

export interface ExportMode {
  format: ExportFormat;
  bundleJars: boolean;
}

/**
 * Le lanceur se charge-t-il lui-meme des fichiers non distribuables ?
 *
 * Un manifeste CurseForge ne contient que des numeros de projet et de
 * fichier : l'application CurseForge ouvre elle-meme la page quand l'auteur
 * refuse la distribution. Dans ce seul cas, l'absence du jar n'est pas un
 * probleme. Un .mrpack, lui, n'accepte que des liens Modrinth, GitHub ou
 * GitLab : le fichier doit donc etre embarque, et il faut l'avoir.
 */
function launcherHandlesManual(mode: ExportMode): boolean {
  return mode.format === "curseforge" && !mode.bundleJars;
}

function label(r: ModResolution): string {
  return r.kind === "mod" ? r.name : `${r.name} (${CONTENT_INFO[r.kind].label})`;
}

export function checkReadiness(
  state: Pick<MergeState, "resolutions" | "conflicts" | "manualFiles" | "failedDownloads">,
  mode: ExportMode,
): Readiness {
  const missing: Blocker[] = state.resolutions
    .filter((r) => r.status === "missing")
    .map((r) => ({
      kind: "missing" as const,
      key: r.key,
      name: label(r),
      detail: r.reason || "aucune version compatible trouvee",
    }));

  const have: Record<string, ManualFileInfo> = state.manualFiles;
  const attente = launcherHandlesManual(mode)
    ? []
    : pendingDownloads(state.resolutions, have, new Set(state.failedDownloads));

  const manual: Blocker[] = attente
    .filter((p) => p.reason === "distribution")
    .map((p) => ({
      kind: "manual" as const,
      key: p.key,
      name: p.name,
      detail: `${p.fileName} — a telecharger depuis sa page`,
    }));

  const failed: Blocker[] = attente
    .filter((p) => p.reason === "echec")
    .map((p) => ({
      kind: "failed" as const,
      key: p.key,
      name: p.name,
      detail: `${p.fileName} — le telechargement precedent a echoue`,
    }));

  const warnings: string[] = [];
  const durs = state.conflicts.filter((c) => c.severity === "hard");
  if (durs.length) {
    warnings.push(
      `${durs.length} conflit${durs.length > 1 ? "s" : ""} bloquant${durs.length > 1 ? "s" : ""} ` +
        "non resolu : le pack se generera, mais plantera au demarrage tant que deux mods du " +
        "meme groupe cohabitent.",
    );
  }
  const instables = state.resolutions.filter(
    (r) => (r.status === "ok" || r.status === "substituted") && r.unstable,
  );
  if (instables.length) {
    warnings.push(
      `${instables.length} element${instables.length > 1 ? "s" : ""} en version non stable, ` +
        "faute de release pour cette cible.",
    );
  }

  const blockers = [...missing, ...manual, ...failed];
  return { ready: blockers.length === 0, blockers, missing, manual, failed, warnings };
}

/** Ce qui manque, en une phrase, pour un bouton ou un titre. */
export function summarizeBlockers(r: Readiness): string {
  const bouts: string[] = [];
  if (r.missing.length) {
    bouts.push(`${r.missing.length} sans version compatible`);
  }
  if (r.manual.length) {
    bouts.push(`${r.manual.length} a recuperer a la main`);
  }
  if (r.failed.length) {
    bouts.push(
      `${r.failed.length} dont le telechargement a echoue`,
    );
  }
  return bouts.join(", ");
}
