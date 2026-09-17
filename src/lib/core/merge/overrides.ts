import { strFromU8, strToU8 } from "fflate";
import { bytesEqual } from "../hash";
import { looksBinary } from "../zip";
import type { OverrideConflict, OverrideDecision } from "../types";

/**
 * Fusion des fichiers d'instance (configs, scripts, KubeJS, resourcepacks…)
 * entre un nombre quelconque de packs.
 *
 * La plupart des fichiers n'existent que dans un pack : ils sont copies tels
 * quels. Les vrais conflits sont les fichiers fournis par plusieurs packs
 * avec des contenus differents — c'est la seule chose qu'on demande a
 * l'utilisateur d'arbitrer.
 */

export interface PackFiles {
  packId: string;
  label: string;
  files: Record<string, Uint8Array>;
}

const JSON_EXT = /\.(json|json5|jsonc)$/i;
const KEYVAL_EXT = /\.(toml|cfg|properties|conf|ini)$/i;

/** Fichiers propres a une instance, qu'il ne faut jamais fusionner. */
const NEVER_MERGE = [
  /(^|\/)options\.txt$/i,
  /(^|\/)servers\.dat$/i,
  /(^|\/)saves\//i,
  /(^|\/)screenshots\//i,
  /(^|\/)logs\//i,
  /(^|\/)crash-reports\//i,
];

function classify(path: string, data: Uint8Array): OverrideConflict["kind"] {
  if (looksBinary(data)) return "binary";
  if (JSON_EXT.test(path)) return "json";
  if (KEYVAL_EXT.test(path)) return "keyvalue";
  return "text";
}

export function computeOverrideConflicts(packs: PackFiles[]): {
  conflicts: OverrideConflict[];
  uniqueCount: number;
  identicalCount: number;
} {
  // Regroupe toutes les contributions par chemin de destination
  const byPath = new Map<string, { packId: string; label: string; data: Uint8Array }[]>();
  for (const p of packs) {
    for (const [path, data] of Object.entries(p.files)) {
      const list = byPath.get(path) ?? [];
      list.push({ packId: p.packId, label: p.label, data });
      byPath.set(path, list);
    }
  }

  const conflicts: OverrideConflict[] = [];
  let uniqueCount = 0;
  let identicalCount = 0;

  for (const [path, sides] of byPath) {
    if (sides.length === 1) {
      uniqueCount++;
      continue;
    }
    // Tous identiques : aucun arbitrage necessaire
    if (sides.every((s) => bytesEqual(s.data, sides[0].data))) {
      identicalCount++;
      continue;
    }

    const kind = classify(path, sides[0].data);
    const blocked = NEVER_MERGE.some((re) => re.test(path));
    const mergeable = !blocked && (kind === "json" || kind === "keyvalue");

    conflicts.push({
      path,
      sides: sides.map((s) => ({ packId: s.packId, label: s.label, size: s.data.length })),
      kind,
      mergeable,
      // Par defaut on fusionne si on sait le faire, sinon le pack prioritaire
      // (le premier de la liste) l'emporte.
      suggestion: mergeable ? "merge" : sides[0].packId,
      note: blocked
        ? "Fichier propre a une instance : fusion deconseillee."
        : kind === "binary"
          ? "Fichier binaire : il faut choisir une version."
          : mergeable
            ? "Fusion cle par cle possible."
            : "Format non fusionnable automatiquement : choisir une version.",
    });
  }

  return {
    conflicts: conflicts.sort((a, b) => a.path.localeCompare(b.path)),
    uniqueCount,
    identicalCount,
  };
}

/* ------------------------------------------------------------------ */
/* Strategies de fusion                                                */
/* ------------------------------------------------------------------ */

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/**
 * Fusion JSON profonde. Les objets sont fusionnes recursivement, les tableaux
 * unis sans doublons (cas frequent : listes de blocs ou d'exclusions), et une
 * valeur scalaire divergente revient au premier pack de la liste, c'est-a-dire
 * au plus prioritaire.
 */
export function mergeJson(values: Json[]): Json {
  return values.reduce((acc, v) => mergeTwo(acc, v));
}

/**
 * Clefs qu'on n'ecrit jamais lors d'une fusion.
 *
 * Les configs viennent d'archives fournies par l'utilisateur, et JSON.parse
 * conserve "__proto__" comme propriete propre : l'affecter ensuite sur un
 * objet declencherait le setter de prototype. On les ignore purement.
 */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function mergeTwo(winner: Json, loser: Json): Json {
  if (Array.isArray(winner) && Array.isArray(loser)) {
    const seen = new Set<string>();
    const out: Json[] = [];
    for (const item of [...winner, ...loser]) {
      const k = JSON.stringify(item);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(item);
    }
    return out;
  }
  if (isObject(winner) && isObject(loser)) {
    const out: { [k: string]: Json } = {};
    for (const k of Object.keys(winner)) {
      if (UNSAFE_KEYS.has(k)) continue;
      out[k] = winner[k];
    }
    for (const [k, v] of Object.entries(loser)) {
      if (UNSAFE_KEYS.has(k)) continue;
      // hasOwnProperty et non l'operateur "in" : sinon une clef de config
      // nommee "toString" ou "valueOf" serait fusionnee contre la methode
      // heritee d'Object.prototype au lieu d'etre traitee comme nouvelle.
      out[k] = hasOwn(winner, k) ? mergeTwo(winner[k], v) : v;
    }
    return out;
  }
  return winner;
}

function isObject(v: Json): v is { [k: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Fusion cle=valeur pour TOML/properties/cfg. On garde la structure et les
 * commentaires du fichier prioritaire, et on ajoute a la fin les cles que
 * seuls les autres definissent.
 */
export function mergeKeyValue(texts: { label: string; text: string }[]): string {
  const [base, ...others] = texts;
  const keyOf = (line: string): string | null => {
    const m = /^\s*([A-Za-z0-9_.\-[\]"']+)\s*[=:]/.exec(line);
    return m ? m[1].replace(/["']/g, "") : null;
  };

  const known = new Set<string>();
  let section = "";
  for (const line of base.text.split(/\r?\n/)) {
    const sec = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (sec) section = sec[1];
    const k = keyOf(line);
    if (k) known.add(`${section}/${k}`);
  }

  const extras: string[] = [];
  for (const other of others) {
    section = "";
    const lines: string[] = [];
    for (const line of other.text.split(/\r?\n/)) {
      const sec = /^\s*\[([^\]]+)\]\s*$/.exec(line);
      if (sec) {
        section = sec[1];
        continue;
      }
      const k = keyOf(line);
      if (k && !known.has(`${section}/${k}`)) {
        known.add(`${section}/${k}`);
        lines.push(section ? `${line}  # [${section}]` : line);
      }
    }
    if (lines.length) {
      extras.push(
        `\n# --- Ajoute depuis le pack ${other.label} lors de la fusion ---\n` +
          lines.join("\n"),
      );
    }
  }

  if (!extras.length) return base.text;
  return base.text.replace(/\s*$/, "") + "\n" + extras.join("\n") + "\n";
}

export interface OverrideSide {
  packId: string;
  label: string;
  data: Uint8Array;
}

/**
 * Applique une decision a un fichier fourni par plusieurs packs.
 * `decision` vaut un id de pack, "merge", "all" ou "skip".
 */
export function applyDecision(
  path: string,
  sides: OverrideSide[],
  decision: OverrideDecision,
): { path: string; data: Uint8Array }[] {
  if (decision === "skip") return [];

  if (decision === "all") {
    // Le pack prioritaire garde le chemin, les autres sont suffixes pour que
    // l'utilisateur puisse les reconcilier lui-meme.
    const [first, ...rest] = sides;
    const dot = path.lastIndexOf(".");
    return [
      { path, data: first.data },
      ...rest.map((s) => ({
        path:
          dot > 0
            ? `${path.slice(0, dot)}.depuis-pack-${s.label}${path.slice(dot)}`
            : `${path}.depuis-pack-${s.label}`,
        data: s.data,
      })),
    ];
  }

  if (decision === "merge") {
    try {
      if (JSON_EXT.test(path)) {
        const parsed = sides.map((s) => JSON.parse(stripJsonComments(strFromU8(s.data))) as Json);
        return [{ path, data: strToU8(JSON.stringify(mergeJson(parsed), null, 2) + "\n") }];
      }
      const texts = sides.map((s) => ({ label: s.label, text: strFromU8(s.data) }));
      return [{ path, data: strToU8(mergeKeyValue(texts)) }];
    } catch {
      // JSON invalide ou encodage exotique : mieux vaut le fichier prioritaire
      // intact qu'un fichier fusionne casse.
      return [{ path, data: sides[0].data }];
    }
  }

  const chosen = sides.find((s) => s.packId === decision) ?? sides[0];
  return [{ path, data: chosen.data }];
}

function stripJsonComments(s: string): string {
  return s
    .replace(/^\uFEFF/, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'\\])\/\/.*$/gm, "$1")
    .replace(/,(\s*[}\]])/g, "$1");
}
