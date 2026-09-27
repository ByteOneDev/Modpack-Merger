import { normalizeTitle } from "../providers";
import type { ModResolution } from "../types";

/**
 * Un meme mod ne doit jamais figurer deux fois dans le pack.
 *
 * La deduplication d'avant resolution compare ce que les packs declarent.
 * Elle ne voit pas ce qui apparait ensuite : une dependance ajoutee depuis
 * Modrinth alors que le meme mod vient d'un pack CurseForge (Iris exige
 * « modrinth:Sodium », le pack fournit « curseforge:Sodium »), une
 * substitution qui retombe sur un mod deja present. Deux jars du meme mod
 * font refuser le demarrage au loader.
 *
 * Parmi les exemplaires d'un meme mod, la version publiee le plus recemment
 * est conservee — sauf si l'utilisateur en a designe une autre.
 */

const kept = (r: ModResolution) =>
  (r.status === "ok" || r.status === "substituted") && !!r.picked;

/** Identifiants qui designent un meme mod, quelle que soit la plateforme. */
function identities(r: ModResolution): string[] {
  const out: string[] = [];
  const v = r.picked!;
  out.push(`p:${v.provider}:${v.projectId}`);
  if (v.hashes.sha1) out.push(`h:${v.hashes.sha1.toLowerCase()}`);
  if (r.project?.slug) out.push(`s:${r.kind}:${r.project.slug.toLowerCase()}`);
  const title = normalizeTitle(r.project?.title ?? "");
  if (title.length >= 4) out.push(`n:${r.kind}:${title}`);
  // L'identifiant du jar ne vaut que tant que le mod n'a pas ete remplace.
  if (r.status === "ok" && r.source?.modId) out.push(`m:${r.source.modId.toLowerCase()}`);
  return out;
}

function publishedAt(r: ModResolution): number {
  const t = Date.parse(r.picked?.datePublished ?? "");
  return Number.isNaN(t) ? 0 : t;
}

/** Le meilleur exemplaire : choix explicite, puis le plus recent, puis le premier. */
function better(a: ModResolution, b: ModResolution): boolean {
  if (!!a.keptByUser !== !!b.keptByUser) return !!a.keptByUser;
  return publishedAt(a) > publishedAt(b);
}

export function collapseDuplicates(resolutions: ModResolution[]): ModResolution[] {
  // Regroupement transitif : A partage un slug avec B, B un hash avec C.
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(k, root);
    return root;
  };
  const byIdentity = new Map<string, string>();

  for (const r of resolutions) {
    if (!kept(r)) continue;
    parent.set(r.key, r.key);
    for (const id of identities(r)) {
      const other = byIdentity.get(id);
      if (other) parent.set(find(r.key), find(other));
      else byIdentity.set(id, r.key);
    }
  }

  const groups = new Map<string, ModResolution[]>();
  for (const r of resolutions) {
    if (!kept(r)) continue;
    const root = find(r.key);
    groups.set(root, [...(groups.get(root) ?? []), r]);
  }

  const losers = new Map<string, ModResolution>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const winner = members.reduce((w, r) => (better(r, w) ? r : w));
    for (const r of members) if (r !== winner) losers.set(r.key, winner);
  }
  if (!losers.size) return resolutions;

  return resolutions.map((r) => {
    const winner = losers.get(r.key);
    if (!winner) return r;
    const why = winner.keptByUser
      ? "tu as choisi de garder l'autre exemplaire"
      : `${winner.picked!.versionNumber} est plus recente que ${r.picked!.versionNumber}`;
    return {
      ...r,
      status: "duplicate" as const,
      picked: undefined,
      duplicateOf: winner.key,
      keptByUser: undefined,
      beforeExclusion: { status: r.status, picked: r.picked, reason: r.reason },
      reason: `Deja dans le pack sous le nom ${winner.name} : ${why}.`,
    };
  });
}
