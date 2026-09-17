/**
 * Hachage sans dependance Node : l'app tourne entierement dans le navigateur.
 *
 * SHA-1 est implemente ici plutot que via crypto.subtle parce que l'API Web
 * Crypto est asynchrone : rendre le hachage async contaminerait tout le
 * parcours de lecture d'archive pour aucun gain, sur des fichiers qui font
 * quelques mega-octets.
 */

export function sha1(data: Uint8Array): string {
  const ml = data.length;
  // padding : 1 bit a 1, des zeros, puis la longueur sur 64 bits
  const withPad = new Uint8Array((((ml + 8) >> 6) + 1) << 6);
  withPad.set(data);
  withPad[ml] = 0x80;
  const bitLen = ml * 8;
  const dv = new DataView(withPad.buffer);
  dv.setUint32(withPad.length - 4, bitLen >>> 0, false);
  dv.setUint32(withPad.length - 8, Math.floor(bitLen / 0x100000000), false);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe;
  let h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let i = 0; i < withPad.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4, false);
    for (let j = 16; j < 80; j++) {
      const n = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16];
      w[j] = (n << 1) | (n >>> 31);
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j++) {
      let f: number, k: number;
      if (j < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (j < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }

      const tmp = (((a << 5) | (a >>> 27)) + f + e + k + w[j]) >>> 0;
      e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = tmp;
    }

    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }

  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, "0")).join("");
}

/**
 * Empreinte CurseForge : murmur2 (seed 1) calcule apres suppression des
 * octets 9, 10, 13 et 32 du fichier. Aucune bibliotheque ne reproduit
 * exactement cette normalisation, d'ou la reimplementation.
 */
export function curseforgeFingerprint(buf: Uint8Array): number {
  let len = 0;
  const norm = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 9 || b === 10 || b === 13 || b === 32) continue;
    norm[len++] = b;
  }

  const m = 0x5bd1e995;
  const r = 24;
  let h = (1 ^ len) >>> 0;
  let i = 0;

  while (len - i >= 4) {
    let k =
      (norm[i] | (norm[i + 1] << 8) | (norm[i + 2] << 16) | (norm[i + 3] << 24)) >>> 0;
    k = Math.imul(k, m) >>> 0;
    k = (k ^ (k >>> r)) >>> 0;
    k = Math.imul(k, m) >>> 0;
    h = Math.imul(h, m) >>> 0;
    h = (h ^ k) >>> 0;
    i += 4;
  }

  const rest = len - i;
  if (rest === 3) h = (h ^ (norm[i + 2] << 16)) >>> 0;
  if (rest >= 2) h = (h ^ (norm[i + 1] << 8)) >>> 0;
  if (rest >= 1) {
    h = (h ^ norm[i]) >>> 0;
    h = Math.imul(h, m) >>> 0;
  }

  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, m) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h >>> 0;
}

/** Egalite d'octets : suffit pour comparer deux fichiers de configuration. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
