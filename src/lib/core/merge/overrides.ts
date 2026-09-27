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
  /**
   * Date de modification de chaque fichier, par chemin de destination. Seules
   * les dates jugees fiables y figurent (voir reliableDates).
   */
  dates?: Record<string, number>;
}

/**
 * Ecarte les dates qui ne disent rien.
 *
 * Certains outils d'export datent tous les fichiers de l'instant de l'export :
 * la date d'un fichier n'y dit rien de sa derniere modification. Quand
 * presque tout un pack porte la meme date, on n'en garde aucune.
 */
export function reliableDates(dates: Record<string, number>): Record<string, number> {
  const values = Object.values(dates);
  if (values.length < 5) return dates;
  const counts = new Map<number, number>();
  // A la minute pres : un export qui dure quelques secondes reste un seul instant.
  for (const v of values) {
    const minute = Math.floor(v / 60_000);
    counts.set(minute, (counts.get(minute) ?? 0) + 1);
  }
  const top = Math.max(...counts.values());
  return top / values.length >= 0.9 ? {} : dates;
}

interface DatedSide {
  packId: string;
  modified?: number;
}

/**
 * Ordre dans lequel les versions d'un fichier font autorite : la plus
 * recente d'abord quand toutes sont datees et qu'une seule est la plus
 * recente, sinon l'ordre des packs.
 */
export function orderSides<T extends DatedSide>(sides: T[]): { ordered: T[]; newest?: T } {
  const dated = sides.every((s) => s.modified !== undefined);
  if (!dated) return { ordered: sides };
  const max = Math.max(...sides.map((s) => s.modified!));
  const newest = sides.filter((s) => s.modified === max);
  if (newest.length !== 1) return { ordered: sides };
  // Tri stable : a date egale, l'ordre des packs departage.
  return { ordered: [...sides].sort((a, b) => b.modified! - a.modified!), newest: newest[0] };
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
  const byPath = new Map<
    string,
    { packId: string; label: string; data: Uint8Array; modified?: number }[]
  >();
  for (const p of packs) {
    for (const [path, data] of Object.entries(p.files)) {
      const list = byPath.get(path) ?? [];
      list.push({ packId: p.packId, label: p.label, data, modified: p.dates?.[path] });
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
    const { ordered, newest } = orderSides(sides);
    const first = ordered[0];

    // Une fusion garde toutes les cles : c'est un choix sur, qui s'applique
    // d'office. Sinon, la version la plus recente l'emporte quand les dates
    // la designent ; a defaut, rien ne permet de trancher et on demande.
    const auto = mergeable || !!newest;
    const rationale = mergeable
      ? newest
        ? `Fusion des cles ; en cas de valeur differente, la version la plus recente (pack ${first.label}) l'emporte.`
        : `Fusion des cles ; en cas de valeur differente, le pack ${first.label}, le plus haut dans ta liste, l'emporte.`
      : newest
        ? `Version la plus recente : celle du pack ${first.label}.`
        : `Impossible de dire quelle version est la plus recente : le pack ${first.label}, le plus haut dans ta liste, est propose par defaut.`;

    conflicts.push({
      path,
      sides: ordered.map((s) => ({
        packId: s.packId,
        label: s.label,
        size: s.data.length,
        modified: s.modified,
      })),
      kind,
      mergeable,
      suggestion: mergeable ? "merge" : first.packId,
      newestPackId: newest?.packId,
      auto,
      rationale,
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
    // Un tableau de nombres est un n-uplet (couleur, coordonnees, bornes) :
    // unir [255, 0, 0] et [0, 0, 255] donnerait une couleur a quatre
    // composantes. Il se traite comme une valeur scalaire.
    const numeric = (a: Json[]) => a.length > 0 && a.every((x) => typeof x === "number");
    if (numeric(winner) || numeric(loser)) return winner;
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
 * commentaires du fichier prioritaire, et on y ajoute les cles que seuls les
 * autres definissent.
 *
 * Chaque cle ajoutee rejoint sa section dans le fichier prioritaire. Les
 * poser en fin de fichier les rangeait sous la derniere section ouverte : une
 * cle de [client] atterrissait dans [server], ou y doublait une cle existante
 * — un TOML que le mod refuse ensuite de charger.
 */
export function mergeKeyValue(texts: { label: string; text: string }[]): string {
  const [base, ...others] = texts;

  // Configs Forge historiques (`general { ... }`) : la section se lit dans
  // les accolades, qu'on ne suit pas. Mieux vaut le fichier prioritaire
  // intact qu'une cle posee hors de son bloc.
  if (texts.some((t) => /^\s*[\w."' -]+\s*\{\s*$/m.test(t.text))) return base.text;

  const eol = base.text.includes("\r\n") ? "\r\n" : "\n";
  const lines = base.text.replace(/\s*$/, "").split(/\r?\n/);

  // Derniere ligne occupee de chaque section du fichier prioritaire, pour y
  // inserer les ajouts ; la section "" est le preambule avant tout en-tete.
  const known = new Set<string>();
  const sectionEnd = new Map<string, number>();
  const arrayTables = new Set<string>();
  let section = "";
  sectionEnd.set("", -1);
  lines.forEach((line, i) => {
    const h = sectionHeader(line);
    if (h) {
      section = h.name;
      if (h.array) arrayTables.add(section);
      sectionEnd.set(section, i);
      return;
    }
    if (line.trim()) sectionEnd.set(section, i);
    const k = keyOf(line);
    if (k) known.add(`${section}/${k}`);
  });

  const additions = new Map<string, string[]>();
  let added = false;
  for (const other of others) {
    section = "";
    for (const line of other.text.split(/\r?\n/)) {
      const h = sectionHeader(line);
      if (h) {
        section = h.name;
        if (h.array) arrayTables.add(section);
        continue;
      }
      const k = keyOf(line);
      // Les tableaux de tables ([[x]]) repetent le meme nom : impossible de
      // savoir a quelle entree une cle appartient, on n'y touche pas.
      if (!k || arrayTables.has(section) || known.has(`${section}/${k}`)) continue;
      known.add(`${section}/${k}`);
      const list = additions.get(section) ?? [];
      if (!list.length) list.push(`# --- Ajoute depuis le pack ${other.label} lors de la fusion ---`);
      list.push(line);
      additions.set(section, list);
      added = true;
    }
  }
  if (!added) return base.text;

  // Insertion de la fin vers le debut, pour que les positions restent justes.
  const inserts: { at: number; lines: string[] }[] = [];
  const nouvelles: string[] = [];
  for (const [sec, list] of additions) {
    const end = sectionEnd.get(sec);
    if (end !== undefined) inserts.push({ at: end + 1, lines: list });
    else nouvelles.push("", `[${sec}]`, ...list);
  }
  inserts.sort((a, b) => b.at - a.at);
  for (const { at, lines: l } of inserts) lines.splice(at, 0, ...l);

  return [...lines, ...nouvelles].join(eol) + eol;
}

function keyOf(line: string): string | null {
  // Configs Forge 1.12 : "B:enabled=true", ou la lettre est le type.
  const typed = /^\s*[BIDSL]:("[^"]*"|[^=]+?)\s*=/.exec(line);
  if (typed) return typed[1].replace(/["']/g, "");
  const m = /^\s*([A-Za-z0-9_.\-"']+)\s*[=:]/.exec(line);
  return m ? m[1].replace(/["']/g, "") : null;
}

function sectionHeader(line: string): { name: string; array: boolean } | null {
  const arr = /^\s*\[\[\s*([^\]]+?)\s*\]\]\s*(#.*)?$/.exec(line);
  if (arr) return { name: arr[1], array: true };
  const sec = /^\s*\[\s*([^\]]+?)\s*\]\s*(#.*)?$/.exec(line);
  return sec ? { name: sec[1], array: false } : null;
}

export interface OverrideSide {
  packId: string;
  label: string;
  data: Uint8Array;
  modified?: number;
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
  // La version qui fait autorite passe en premier : c'est elle qui garde le
  // chemin d'origine et qui tranche les valeurs divergentes d'une fusion.
  sides = orderSides(sides).ordered;

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

/**
 * Retire commentaires et virgules finales d'un JSON5/JSONC, en respectant les
 * chaines. Une expression reguliere ne sait pas qu'elle est dans une chaine :
 * un chemin "assets/*" suivi d'une fin de commentaire disparaissait, et le resultat restait
 * parfois du JSON valide — donc une config alteree sans aucun signal.
 */
export function stripJsonComments(input: string): string {
  const s = input.replace(/^\uFEFF/, "");
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'") {
      // Chaine recopiee telle quelle, echappements compris.
      let j = i + 1;
      while (j < s.length && s[j] !== c) j += s[j] === "\\" ? 2 : 1;
      out += s.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && s[i + 1] === "/") {
      while (i < s.length && s[i] !== "\n") i++;
    } else if (c === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      i = end === -1 ? s.length : end + 2;
    } else if (c === ",") {
      // Virgule finale : seulement des blancs ou commentaires avant } ou ].
      let j = i + 1;
      for (;;) {
        while (j < s.length && /\s/.test(s[j])) j++;
        if (s[j] === "/" && s[j + 1] === "/") {
          while (j < s.length && s[j] !== "\n") j++;
        } else if (s[j] === "/" && s[j + 1] === "*") {
          const end = s.indexOf("*/", j + 2);
          j = end === -1 ? s.length : end + 2;
        } else break;
      }
      if (s[j] !== "}" && s[j] !== "]") out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
