/**
 * Hachage sans dependance Node : l'app tourne entierement dans le navigateur.
 *
 * SHA-1 est implemente ici plutot que via crypto.subtle parce que l'API Web
 * Crypto est asynchrone : rendre le hachage async contaminerait tout le
 * parcours de lecture d'archive pour aucun gain, sur des fichiers qui font
 * quelques mega-octets.
 */

export function sha1(data: Uint8Array): string {
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe;
  let h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  /** Absorbe un bloc de 64 octets lu a la position donnee. */
  const bloc = (dv: DataView, pos: number) => {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(pos + j * 4, false);
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
  };

  // Les blocs pleins sont lus en place. Copier le fichier entier pour y
  // ajouter le remplissage doublait l'empreinte memoire : sur un mod de
  // 200 Mo, cela faisait 200 Mo de plus pour quelques octets de padding.
  const complets = data.length - (data.length % 64);
  const vue = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < complets; i += 64) bloc(vue, i);

  // Seule la queue est recopiee : un ou deux blocs, jamais plus.
  const reste = data.length - complets;
  const tailleQueue = reste + 9 <= 64 ? 64 : 128;
  const queue = new Uint8Array(tailleQueue);
  queue.set(data.subarray(complets));
  queue[reste] = 0x80;
  const vueQueue = new DataView(queue.buffer);
  const bits = data.length * 8;
  vueQueue.setUint32(tailleQueue - 4, bits >>> 0, false);
  vueQueue.setUint32(tailleQueue - 8, Math.floor(bits / 0x100000000), false);
  for (let i = 0; i < tailleQueue; i += 64) bloc(vueQueue, i);

  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, "0")).join("");
}


/**
 * Empreinte CurseForge : murmur2 (seed 1) calcule apres suppression des
 * octets 9, 10, 13 et 32 du fichier. Aucune bibliotheque ne reproduit
 * exactement cette normalisation, d'ou la reimplementation.
 */
/** Octets ignores par CurseForge avant de calculer l'empreinte. */
function estBlanc(b: number): boolean {
  return b === 9 || b === 10 || b === 13 || b === 32;
}

/**
 * Empreinte murmur2 telle que CurseForge la calcule.
 *
 * La normalisation (retrait des espaces, tabulations et sauts de ligne) se
 * fait a la volee, sans materialiser le tableau normalise : sur un mod de
 * 200 Mo, cette copie doublait a elle seule l'empreinte memoire du parsing.
 */
export function curseforgeFingerprint(buf: Uint8Array): number {
  const taille = buf.length;

  // Premiere passe : la longueur normalisee sert de graine.
  let len = 0;
  for (let i = 0; i < taille; i++) if (!estBlanc(buf[i])) len++;

  const m = 0x5bd1e995;
  const r = 24;
  let h = (1 ^ len) >>> 0;

  let i = 0;
  const suivant = (): number => {
    while (i < taille && estBlanc(buf[i])) i++;
    return buf[i++];
  };

  const reste = len & 3;
  const bloc = len - reste;
  for (let lus = 0; lus < bloc; lus += 4) {
    const b0 = suivant();
    const b1 = suivant();
    const b2 = suivant();
    const b3 = suivant();
    let k = (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
    k = Math.imul(k, m) >>> 0;
    k = (k ^ (k >>> r)) >>> 0;
    k = Math.imul(k, m) >>> 0;
    h = Math.imul(h, m) >>> 0;
    h = (h ^ k) >>> 0;
  }

  // Queue : au plus trois octets, dans l'ordre impose par murmur2.
  const queue: number[] = [];
  for (let n = 0; n < reste; n++) queue.push(suivant());
  if (reste === 3) h = (h ^ (queue[2] << 16)) >>> 0;
  if (reste >= 2) h = (h ^ (queue[1] << 8)) >>> 0;
  if (reste >= 1) {
    h = (h ^ queue[0]) >>> 0;
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
