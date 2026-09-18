import { unzipSync, deflateSync, strFromU8, strToU8 } from "fflate";

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
export interface ZipEntryInfo {
  path: string;
  /** taille une fois decompressee */
  size: number;
}

/**
 * Liste le contenu sans rien decompresser.
 *
 * Permet de decider quoi extraire avant d'en payer le prix : sur un pack de
 * 900 Mo, tout decompresser pour ne garder que quelques jars sature la
 * memoire de l'onglet.
 */
export function listZipEntries(buf: Uint8Array): ZipEntryInfo[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const scanFrom = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= scanFrom; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return [];

  let count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || p === 0xffffffff) {
    const locator = eocd - 20;
    if (locator >= 0 && dv.getUint32(locator, true) === 0x07064b50) {
      const z64 = Number(dv.getBigUint64(locator + 8, true));
      if (z64 >= 0 && z64 + 56 <= buf.length && dv.getUint32(z64, true) === 0x06064b50) {
        count = Number(dv.getBigUint64(z64 + 32, true));
        p = Number(dv.getBigUint64(z64 + 48, true));
      }
    }
  }

  const dec = new TextDecoder();
  const out: ZipEntryInfo[] = [];
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const path = normalizePath(dec.decode(buf.subarray(p + 46, p + 46 + nameLen)));
    if (!path.endsWith("/") && isSafePath(path)) out.push({ path, size });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

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

/* ------------------------------------------------------------------ */
/* Ecriture en flux                                                     */
/* ------------------------------------------------------------------ */

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
 * Au-dela de ~32 Mo accumules, les morceaux sont replies dans un Blob.
 *
 * Un Blob n'occupe pas le tas JavaScript : le navigateur est libre de le
 * garder sur disque. C'est ce qui permet de produire une archive de plusieurs
 * Go la ou un unique Uint8Array echouerait sur "Array buffer allocation
 * failed" — la memoire contigue adressable par un onglet est bornee, quelle
 * que soit la RAM de la machine.
 */
const FLUSH_BYTES = 32 * 1024 * 1024;

/** Seuil au-dela duquel les champs 32 bits du format ne suffisent plus. */
const U32_MAX = 0xffffffff;

const CRC_TABLE = /* @__PURE__ */ (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Date et heure au format MS-DOS, seul format que porte un en-tete zip. */
function dosDateTime(d: Date): { date: number; time: number } {
  const annee = Math.max(1980, d.getFullYear());
  return {
    date: (((annee - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

interface EntryRecord {
  name: Uint8Array;
  crc: number;
  compressed: number;
  uncompressed: number;
  method: number;
  offset: number;
  date: number;
  time: number;
}

/**
 * Archive construite fichier par fichier.
 *
 * Ecrite a la main plutot qu'avec le writer en flux de fflate, pour deux
 * raisons de compatibilite :
 *
 * 1. fflate ne connait pas la longueur d'une entree au moment d'ecrire son
 *    en-tete local : il laisse donc CRC et tailles a zero et pose le drapeau
 *    « descripteur de donnees ». C'est legal, mais c'est la variante du format
 *    la plus mal supportee — QuaZip, qu'utilise Prism Launcher, echoue dessus.
 *    Ici chaque entree est poussee entiere, donc CRC et tailles sont connus
 *    avant l'en-tete : on les y ecrit, et aucun descripteur n'est necessaire.
 * 2. fflate n'ecrit pas les enregistrements Zip64, ce qui plafonne une archive
 *    a 4 Go — un pack complet de plusieurs centaines de mods les depasse.
 *
 * Rien n'est conserve en entier : chaque entree est ecrite puis relachee.
 */
export class ZipStream {
  private readonly entries: EntryRecord[] = [];
  /**
   * Chemins deja ecrits. Une archive qui contient deux fois la meme
   * destination est acceptee par certains outils et refusee par d'autres :
   * autant ne jamais en produire.
   */
  private readonly seen = new Set<string>();
  private parts: BlobPart[] = [];
  private buffered: Uint8Array[] = [];
  private bufferedBytes = 0;
  private written = 0;
  private failure: Error | null = null;
  private pending: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly sink?: ZipSink) {}

  private emit(chunk: Uint8Array): void {
    this.written += chunk.length;
    if (this.sink) {
      const s = this.sink;
      this.pending = this.pending.then(() => s.write(chunk)).catch((e) => {
        this.failure = e instanceof Error ? e : new Error(String(e));
      });
      return;
    }
    this.buffered.push(chunk);
    this.bufferedBytes += chunk.length;
    if (this.bufferedBytes >= FLUSH_BYTES) this.spill();
  }

  private spill(): void {
    if (!this.buffered.length) return;
    this.parts.push(new Blob(this.buffered as BlobPart[]));
    this.buffered = [];
    this.bufferedBytes = 0;
  }

  /**
   * @param compress a laisser a false pour un .jar : c'est deja une archive
   *   compressee, la recompresser coute du temps pour ~0 octet gagne.
   * @returns false si le chemin est refuse ou deja present dans l'archive.
   */
  add(name: string, data: Uint8Array, compress = false): boolean {
    if (this.failure) throw this.failure;
    if (this.closed) throw new Error("Archive deja terminee.");

    const clean = normalizePath(name);
    if (!isSafePath(clean)) return false;

    if (this.seen.has(clean)) return false;

    const nameBytes = strToU8(clean);
    if (nameBytes.length > 0xffff) return false;

    const payload = compress ? deflateSync(data, { level: 6 }) : data;
    // Une compression qui gonfle le fichier : on stocke tel quel.
    const gonfle = compress && payload.length >= data.length;
    const body = gonfle ? data : payload;
    const method = compress && !gonfle ? 8 : 0;

    const { date, time } = dosDateTime(new Date());
    const record: EntryRecord = {
      name: nameBytes,
      crc: crc32(data),
      compressed: body.length,
      uncompressed: data.length,
      method,
      offset: this.written,
      date,
      time,
    };

    // Une entree de plus de 4 Go a besoin de Zip64 des l'en-tete local.
    const gros = record.uncompressed > U32_MAX || record.compressed > U32_MAX;
    const extra = gros ? 20 : 0;

    const header = new Uint8Array(30 + nameBytes.length + extra);
    const dv = new DataView(header.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, gros ? 45 : 20, true); // version minimale pour lire
    dv.setUint16(6, 0x0800, true); // noms en UTF-8, pas de descripteur
    dv.setUint16(8, method, true);
    dv.setUint16(10, time, true);
    dv.setUint16(12, date, true);
    dv.setUint32(14, record.crc, true);
    dv.setUint32(18, gros ? U32_MAX : record.compressed, true);
    dv.setUint32(22, gros ? U32_MAX : record.uncompressed, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, extra, true);
    header.set(nameBytes, 30);
    if (gros) {
      const z = new DataView(header.buffer, 30 + nameBytes.length, 20);
      z.setUint16(0, 0x0001, true);
      z.setUint16(2, 16, true);
      z.setBigUint64(4, BigInt(record.uncompressed), true);
      z.setBigUint64(12, BigInt(record.compressed), true);
    }

    this.emit(header);
    this.emit(body);
    this.entries.push(record);
    this.seen.add(clean);
    return true;
  }

  /** Octets deja ecrits, pour afficher la taille pendant la generation. */
  get bytesWritten(): number {
    return this.written;
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

  /** Catalogue central, puis fin d'archive. */
  private writeDirectory(): void {
    const debut = this.written;

    for (const e of this.entries) {
      const champs: [number, number][] = [];
      if (e.uncompressed > U32_MAX) champs.push([0, e.uncompressed]);
      if (e.compressed > U32_MAX) champs.push([1, e.compressed]);
      if (e.offset > U32_MAX) champs.push([2, e.offset]);
      const extra = champs.length ? 4 + champs.length * 8 : 0;

      const c = new Uint8Array(46 + e.name.length + extra);
      const dv = new DataView(c.buffer);
      dv.setUint32(0, 0x02014b50, true);
      dv.setUint16(4, extra ? 45 : 20, true); // version d'ecriture
      dv.setUint16(6, extra ? 45 : 20, true); // version minimale pour lire
      dv.setUint16(8, 0x0800, true);
      dv.setUint16(10, e.method, true);
      dv.setUint16(12, e.time, true);
      dv.setUint16(14, e.date, true);
      dv.setUint32(16, e.crc, true);
      dv.setUint32(20, e.compressed > U32_MAX ? U32_MAX : e.compressed, true);
      dv.setUint32(24, e.uncompressed > U32_MAX ? U32_MAX : e.uncompressed, true);
      dv.setUint16(28, e.name.length, true);
      dv.setUint16(30, extra, true);
      dv.setUint32(42, e.offset > U32_MAX ? U32_MAX : e.offset, true);
      c.set(e.name, 46);
      if (extra) {
        const z = new DataView(c.buffer, 46 + e.name.length, extra);
        z.setUint16(0, 0x0001, true);
        z.setUint16(2, extra - 4, true);
        // L'ordre est impose par le format : taille decompressee, puis
        // compressee, puis position — et seuls les champs satures figurent.
        champs.forEach(([, valeur], i) => z.setBigUint64(4 + i * 8, BigInt(valeur), true));
      }
      this.emit(c);
    }

    const taille = this.written - debut;
    const nombre = this.entries.length;
    // Zip64 devient obligatoire des qu'un des compteurs sature.
    const besoinZip64 = nombre > 0xffff || debut > U32_MAX || taille > U32_MAX;

    if (besoinZip64) {
      const z = new Uint8Array(56 + 20);
      const dv = new DataView(z.buffer);
      dv.setUint32(0, 0x06064b50, true);
      dv.setBigUint64(4, BigInt(44), true); // taille de l'enregistrement - 12
      dv.setUint16(12, 45, true);
      dv.setUint16(14, 45, true);
      dv.setBigUint64(24, BigInt(nombre), true);
      dv.setBigUint64(32, BigInt(nombre), true);
      dv.setBigUint64(40, BigInt(taille), true);
      dv.setBigUint64(48, BigInt(debut), true);
      // Localisateur : signature (56), disque (60), position de
      // l'enregistrement ci-dessus (64), nombre de disques (72).
      dv.setUint32(56, 0x07064b50, true);
      dv.setBigUint64(64, BigInt(this.written), true);
      dv.setUint32(72, 1, true);
      this.emit(z);
    }

    const fin = new Uint8Array(22);
    const dv = new DataView(fin.buffer);
    dv.setUint32(0, 0x06054b50, true);
    dv.setUint16(8, Math.min(nombre, 0xffff), true);
    dv.setUint16(10, Math.min(nombre, 0xffff), true);
    dv.setUint32(12, Math.min(taille, U32_MAX), true);
    dv.setUint32(16, Math.min(debut, U32_MAX), true);
    this.emit(fin);
  }

  /**
   * Termine l'archive. Renvoie un Blob en l'absence de destination disque,
   * null quand tout a deja ete ecrit dans le fichier choisi.
   */
  async finish(): Promise<Blob | null> {
    if (this.failure) throw this.failure;
    if (!this.closed) {
      this.writeDirectory();
      this.closed = true;
    }
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
    this.closed = true;
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
