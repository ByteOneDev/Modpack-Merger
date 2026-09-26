/**
 * Differences ligne a ligne entre deux fichiers texte.
 *
 * Plus longue sous-sequence commune, apres retrait du debut et de la fin
 * communs : deux configs d'un meme mod ne different en general que de
 * quelques lignes, et le tableau reste petit. Au-dela d'un plafond, on
 * renonce plutot que de figer l'onglet.
 */

export type DiffLine =
  | { type: "same"; text: string; a: number; b: number }
  | { type: "del"; text: string; a: number }
  | { type: "add"; text: string; b: number };

export interface DiffHunk {
  lines: DiffLine[];
}

export type DiffResult =
  | { kind: "identical" }
  | { kind: "tooLarge" }
  | { kind: "diff"; hunks: DiffHunk[]; added: number; removed: number };

const MAX_CELLS = 4_000_000;

export function diffLines(before: string, after: string, context = 2): DiffResult {
  const a = before.replace(/\r\n/g, "\n").split("\n");
  const b = after.replace(/\r\n/g, "\n").split("\n");

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  if (start === endA && start === endB) return { kind: "identical" };

  const n = endA - start;
  const m = endB - start;
  if ((n + 1) * (m + 1) > MAX_CELLS) return { kind: "tooLarge" };

  // lcs[i][j] : longueur commune des suffixes a[start+i..], b[start+j..]
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] =
        a[start + i] === b[start + j]
          ? lcs[(i + 1) * w + j + 1] + 1
          : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }

  const all: DiffLine[] = [];
  for (let k = 0; k < start; k++) all.push({ type: "same", text: a[k], a: k + 1, b: k + 1 });
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      all.push({ type: "same", text: a[start + i], a: start + i + 1, b: start + j + 1 });
      i++;
      j++;
    } else if (i < n && (j === m || lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) {
      // Les suppressions avant les ajouts : l'ancienne ligne, puis la nouvelle.
      all.push({ type: "del", text: a[start + i], a: start + i + 1 });
      i++;
      removed++;
    } else {
      all.push({ type: "add", text: b[start + j], b: start + j + 1 });
      j++;
      added++;
    }
  }
  for (let k = 0; k < a.length - endA; k++) {
    all.push({ type: "same", text: a[endA + k], a: endA + k + 1, b: endB + k + 1 });
  }

  // Seules les lignes changees et leur voisinage immediat sont montrees.
  const keep = new Uint8Array(all.length);
  all.forEach((l, k) => {
    if (l.type === "same") return;
    for (let d = Math.max(0, k - context); d <= Math.min(all.length - 1, k + context); d++) {
      keep[d] = 1;
    }
  });
  const hunks: DiffHunk[] = [];
  let current: DiffLine[] | null = null;
  all.forEach((l, k) => {
    if (!keep[k]) {
      current = null;
      return;
    }
    if (!current) {
      current = [];
      hunks.push({ lines: current });
    }
    current.push(l);
  });

  return { kind: "diff", hunks, added, removed };
}
