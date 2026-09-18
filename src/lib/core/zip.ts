import {
  unzipSync, zipSync, strFromU8, strToU8, Zip, ZipDeflate, ZipPassThrough,
} from "fflate";

export type ZipEntries = Record<string, Uint8Array>;

/**
 * Lecture d'archives fournies par l'utilisateur.
 *
 * Tout ce qui entre ici est hostile par defaut : un .zip est une structure
 * entierement controlee par celui qui le fabrique. Les protections sont
 * appliquees avant toute decompression.
 */

/** Plafonds : un tres gros modpack "tout inclus" depasse rarement 4 Go. */
export const ZIP_LIMITS = {
  /** taille de l'archive compressee */
  maxArchiveBytes: 4 * 1024 ** 3,
  /** taille totale une fois decompressee */
  maxUncompressedBytes: 8 * 1024 ** 3,
  /** nombre d'entrees */
  maxEntries: 200_000,
  /**
   * Ratio de compression global tolere. Une archive legitime de modpack
   * (jars deja compresses, configs texte) reste sous 20. Au-dela, c'est une
   * bombe de decompression : quelques Mo qui en donnent des dizaines de Go.
   */
  maxRatio: 200,
};

export class ZipRejected extends Error {}

/**
 * Rejette les chemins d'archive dangereux avant qu'ils n'atteignent le
 * disque ou l'archive de sortie : traversee de repertoire (zip slip),
 * chemins absolus, et noms qui manipuleraient la chaine de prototypes en
 * devenant des clefs d'objet.
 */
export function isSafePath(p: string): boolean {
  if (!p || p.startsWith("/") || p.startsWith("\\")) return false;
  if (/^[a-zA-Z]:/.test(p)) return false;
  return !p
    .split(/[\\/]/)
    .some(
      (seg) =>
        seg === ".." ||
        seg === "." ||
        seg === "__proto__" ||
        seg === "constructor" ||
        seg === "prototype" ||
        seg.includes("\0"),
    );
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

export interface ZipSurvey {
  entryCount: number;
  compressedBytes: number;
  uncompressedBytes: number;
  ratio: number;
}

/**
 * Inspecte le catalogue central de l'archive sans rien decompresser.
 *
 * C'est la seule facon de connaitre la taille reelle avant de la payer :
 * une fois unzipSync lance, une bombe de decompression a deja sature la
 * memoire de l'onglet.
 */
export function surveyZip(buf: Uint8Array): ZipSurvey {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // Le End Of Central Directory est en fin de fichier, apres un commentaire
  // de longueur variable : on le cherche a rebours sur 64 Ko au plus.
  const scanFrom = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= scanFrom; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new ZipRejected("Archive illisible : catalogue introuvable.");

  let entryCount = dv.getUint16(eocd + 10, true);
  let cdOffset = dv.getUint32(eocd + 16, true);

  // Zip64 : les champs 32 bits saturent a 0xFFFF / 0xFFFFFFFF et la vraie
  // valeur vit dans un enregistrement separe.
  if (entryCount === 0xffff || cdOffset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator >= 0 && dv.getUint32(locator, true) === 0x07064b50) {
      const z64 = Number(dv.getBigUint64(locator + 8, true));
      if (z64 >= 0 && z64 + 56 <= buf.length && dv.getUint32(z64, true) === 0x06064b50) {
        entryCount = Number(dv.getBigUint64(z64 + 32, true));
        cdOffset = Number(dv.getBigUint64(z64 + 48, true));
      }
    }
  }

  if (entryCount > ZIP_LIMITS.maxEntries) {
    throw new ZipRejected(
      `Archive refusee : ${entryCount.toLocaleString("fr")} entrees, au-dela de la limite de ${ZIP_LIMITS.maxEntries.toLocaleString("fr")}.`,
    );
  }

  let compressed = 0;
  let uncompressed = 0;
  let p = cdOffset;

  for (let i = 0; i < entryCount && p + 46 <= buf.length; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    compressed += dv.getUint32(p + 20, true);
    uncompressed += dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    p += 46 + nameLen + extraLen + commentLen;

    if (uncompressed > ZIP_LIMITS.maxUncompressedBytes) {
      throw new ZipRejected(
        "Archive refusee : son contenu decompresse depasse 8 Go. " +
          "C'est soit un pack anormalement gros, soit une archive piegee.",
      );
    }
  }

  const ratio = compressed > 0 ? uncompressed / compressed : 1;
  if (ratio > ZIP_LIMITS.maxRatio && uncompressed > 64 * 1024 ** 2) {
    throw new ZipRejected(
      `Archive refusee : taux de compression de ${Math.round(ratio)}:1, ` +
        "caracteristique d'une bombe de decompression.",
    );
  }

  return {
    entryCount,
    compressedBytes: compressed,
    uncompressedBytes: uncompressed,
    ratio,
  };
}

/**
 * @param keep filtre applique *avant* decompression. Sauter les jars quand on
 *   ne veut que les fichiers de configuration evite de charger plusieurs Go
 *   en memoire pour rien.
 */
export function readZip(buf: Uint8Array, keep?: (path: string) => boolean): ZipEntries {
  if (buf.length > ZIP_LIMITS.maxArchiveBytes) {
    throw new ZipRejected("Archive refusee : plus de 4 Go.");
  }
  surveyZip(buf);

  const raw = unzipSync(
    buf,
    keep ? { filter: (f) => keep(normalizePath(f.name)) } : undefined,
  );
  // Prototype nul : les noms d'entrees viennent de l'archive, ils ne doivent
  // pas pouvoir atteindre Object.prototype en devenant des clefs.
  const out: ZipEntries = Object.create(null) as ZipEntries;
  for (const [name, data] of Object.entries(raw)) {
    if (name.endsWith("/")) continue; // dossier
    const clean = normalizePath(name);
    if (!isSafePath(clean)) continue; // entree hostile : ignoree
    out[clean] = data;
  }
  return out;
}

export function writeZip(entries: ZipEntries, level: 0 | 6 | 9 = 6): Uint8Array {
  const safe: ZipEntries = {};
  for (const [name, data] of Object.entries(entries)) {
    const clean = normalizePath(name);
    if (isSafePath(clean)) safe[clean] = data;
  }
  return zipSync(safe, { level });
}

/* ------------------------------------------------------------------ */
/* Ecriture en flux                                                     */
/* ------------------------------------------------------------------ */

/**
 * Au-dela de ~32 Mo accumules, les morceaux sont replies dans un Blob.
 *
 * Un Blob n'occupe pas le tas JavaScript : le navigateur est libre de le
 * garder sur disque. C'est ce qui permet de produire une archive de plusieurs
 * Go la ou un unique Uint8Array echouerait sur "Array buffer allocation
 * failed" — la memoire contigue adressable par un onglet est bornee, quelle
 * que soit la RAM de la machine.
 */
const FLUSH_BYTES = 32 * 1024 * 1024;

/**
 * Destination d'ecriture directe, quand le navigateur en propose une.
 *
 * Ecrire au fil de l'eau dans un fichier choisi par l'utilisateur evite de
 * detenir l'archive : ni en memoire, ni dans le stockage de Blobs du
 * navigateur, qui a lui aussi un plafond.
 */
export interface ZipSink {
  write: (chunk: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  abort?: () => Promise<void>;
}

/**
 * Archive construite fichier par fichier.
 *
 * Contrairement a writeZip, rien n'est conserve en entier : chaque entree est
 * poussee puis relachee. Un pack complet de 400 mods represente facilement
 * 1,5 Go, soit bien au-dela de ce qu'un seul tableau d'octets peut couvrir.
 */
export class ZipStream {
  private readonly zip: Zip;
  private parts: BlobPart[] = [];
  private buffered: Uint8Array[] = [];
  private bufferedBytes = 0;
  private written = 0;
  private failure: Error | null = null;
  private finished = false;
  private onFinished: (() => void) | null = null;
  /** ecritures en attente vers le disque, enchainees pour rester ordonnees */
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly sink?: ZipSink) {
    this.zip = new Zip((err, data, final) => {
      if (err) {
        this.failure = err instanceof Error ? err : new Error(String(err));
        return;
      }
      if (data) {
        this.written += data.length;
        if (this.sink) {
          // fflate peut reutiliser ses tampons : on copie avant de differer.
          const copy = data.slice();
          const s = this.sink;
          this.pending = this.pending.then(() => s.write(copy)).catch((e) => {
            this.failure = e instanceof Error ? e : new Error(String(e));
          });
        } else {
          this.buffered.push(data);
          this.bufferedBytes += data.length;
          if (this.bufferedBytes >= FLUSH_BYTES) this.spill();
        }
      }
      if (final) {
        this.finished = true;
        this.onFinished?.();
      }
    });
  }

  private spill(): void {
    if (!this.buffered.length) return;
    this.parts.push(new Blob(this.buffered as BlobPart[]));
    this.buffered = [];
    this.bufferedBytes = 0;
  }

  /**
   * Attend que tout ce qui a ete pousse soit reellement ecrit.
   *
   * A appeler entre deux gros fichiers : sans cela les ecritures disque
   * s'accumuleraient en memoire, ce que le mode flux cherche justement a
   * eviter.
   */
  async drain(): Promise<void> {
    if (this.sink) await this.pending;
    if (this.failure) throw this.failure;
  }

  /**
   * @param compress a laisser a false pour un .jar : c'est deja une archive
   *   compressee, la recompresser coute du temps pour ~0 octet gagne.
   */
  add(name: string, data: Uint8Array, compress = false): boolean {
    if (this.failure) throw this.failure;
    const clean = normalizePath(name);
    if (!isSafePath(clean)) return false;

    const entry = compress
      ? new ZipDeflate(clean, { level: 6 })
      : new ZipPassThrough(clean);
    this.zip.add(entry);
    // Pousse en un seul bloc, donc immediatement emis : fflate n'a jamais a
    // mettre une entree en attente derriere une autre.
    entry.push(data, true);

    if (this.failure) throw this.failure;
    return true;
  }

  /** Octets deja ecrits, pour afficher la taille pendant la generation. */
  get bytesWritten(): number {
    return this.written;
  }

  /**
   * Termine l'archive. Renvoie un Blob en l'absence de destination disque,
   * null quand tout a deja ete ecrit dans le fichier choisi.
   */
  async finish(): Promise<Blob | null> {
    if (this.failure) throw this.failure;
    await new Promise<void>((resolve) => {
      this.onFinished = resolve;
      this.zip.end();
      if (this.finished) resolve();
    });
    if (this.sink) {
      await this.pending;
      if (this.failure) throw this.failure;
      await this.sink.close();
      return null;
    }
    if (this.failure) throw this.failure;
    this.spill();
    return new Blob(this.parts, { type: "application/zip" });
  }

  /** Abandonne l'ecriture en cours, pour ne pas laisser un fichier tronque. */
  async abort(): Promise<void> {
    await this.sink?.abort?.().catch(() => {});
  }
}

/** Extensions deja compressees : les stocker tel quel plutot que les deflater. */
export function isPrecompressed(path: string): boolean {
  return /\.(jar|zip|png|jpg|jpeg|webp|ogg|mp3|litematic|schem|nbt|gz|xz|7z)$/i.test(path);
}

export function readText(entries: ZipEntries, path: string): string | null {
  const data = entries[path];
  return data ? strFromU8(data) : null;
}

export function readJson<T>(entries: ZipEntries, path: string): T | null {
  const text = readText(entries, path);
  if (text === null) return null;
  try {
    // certains packs sont sauvegardes en UTF-8 avec BOM
    return JSON.parse(text.replace(/^﻿/, "")) as T;
  } catch {
    return null;
  }
}

export function toU8(s: string): Uint8Array {
  return strToU8(s);
}

/** Heuristique texte/binaire : presence d'octets nuls sur le debut du fichier. */
export function looksBinary(data: Uint8Array): boolean {
  const n = Math.min(data.length, 8000);
  for (let i = 0; i < n; i++) if (data[i] === 0) return true;
  return false;
}
