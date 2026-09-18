import {
  LOADER_COMPAT,
  type LoaderId,
  type MergeTarget,
  type ModResolution,
  type PackMod,
  type ProviderProject,
  type ProviderVersion,
} from "../types";
import { modrinth, curseforge, providerOf, normalizeTitle } from "../providers";
import { LOADER_ONLY } from "./knowledge";
import { CONTENT_INFO, providerLoaders, type ContentKind } from "../content";

/* ------------------------------------------------------------------ */
/* Deduplication                                                       */
/* ------------------------------------------------------------------ */

export interface DedupedMod {
  primary: PackMod;
  duplicates: PackMod[];
  /** etiquettes des packs qui apportaient ce mod */
  labels: string[];
}

/**
 * Regroupe les mods identiques venant de tous les packs. Un mod est le meme
 * s'il partage un identifiant de projet, une empreinte de fichier, un modId
 * de jar ou un titre normalise.
 */
export function dedupe(
  mods: PackMod[],
  labelOf: (m: PackMod) => string,
): DedupedMod[] {
  const groups: DedupedMod[] = [];
  const index = new Map<string, DedupedMod>();

  const keysOf = (m: PackMod): string[] => {
    const keys: string[] = [];
    if (m.provider !== "unknown" && m.projectId) keys.push(`p:${m.provider}:${m.projectId}`);
    if (m.hashes.sha1) keys.push(`h:${m.hashes.sha1}`);
    if (m.modId) keys.push(`m:${m.modId.toLowerCase()}`);
    if (m.slug) keys.push(`s:${m.slug.toLowerCase()}`);
    const n = normalizeTitle(m.name);
    if (n.length >= 4) keys.push(`n:${n}`);
    return keys;
  };

  for (const mod of mods) {
    const keys = keysOf(mod);
    const existing = keys.map((k) => index.get(k)).find(Boolean);
    const label = labelOf(mod);

    if (existing) {
      existing.duplicates.push(mod);
      if (!existing.labels.includes(label)) existing.labels.push(label);
      // le mod le mieux identifie devient le representant du groupe
      if (existing.primary.provider === "unknown" && mod.provider !== "unknown") {
        existing.duplicates.push(existing.primary);
        existing.duplicates = existing.duplicates.filter((d) => d !== mod);
        existing.primary = mod;
      }
      for (const k of keys) index.set(k, existing);
    } else {
      const group: DedupedMod = { primary: mod, duplicates: [], labels: [label] };
      groups.push(group);
      for (const k of keys) index.set(k, group);
    }
  }

  return groups;
}

/* ------------------------------------------------------------------ */
/* Choix de version                                                    */
/* ------------------------------------------------------------------ */

const TYPE_RANK = { release: 0, beta: 1, alpha: 2 } as const;

/**
 * Choisit la version la plus recente parmi les plus stables : une release
 * recente bat toujours une beta plus recente. Une beta n'est retenue qu'en
 * l'absence de release, sauf si preferStable est desactive.
 */
/**
 * Versions acceptables pour ce type de contenu.
 *
 * Un resource pack n'est publie sous aucun mod loader — il l'est sous
 * "minecraft" — et un shader sous "iris" ou "optifine". Leur appliquer la
 * compatibilite entre loaders de mods revient a tout rejeter.
 */
function acceptsLoader(v: ProviderVersion, target: MergeTarget, kind: ContentKind): boolean {
  if (kind === "mod") {
    return v.loaders.some((l) => LOADER_COMPAT[target.loader].includes(l as LoaderId));
  }
  const allowed = providerLoaders(kind, LOADER_COMPAT[target.loader]);
  // CurseForge ne declare pas de loader pour un resource pack : une liste
  // vide veut dire "pas concerne", pas "incompatible".
  if (!allowed.length || !v.loaders.length) return true;
  return v.loaders.some((l) => allowed.includes(l));
}

export function pickBestVersion(
  versions: ProviderVersion[],
  target: MergeTarget,
  preferStable = true,
  kind: ContentKind = "mod",
): ProviderVersion | null {
  const pool = versions.filter(
    (v) => v.gameVersions.includes(target.minecraft) && acceptsLoader(v, target, kind),
  );
  if (!pool.length) return null;

  return [...pool].sort((a, b) => {
    if (preferStable) {
      const rank = TYPE_RANK[a.versionType] - TYPE_RANK[b.versionType];
      if (rank !== 0) return rank;
    }
    if (kind === "mod") {
      const exactA = a.loaders.includes(target.loader) ? 0 : 1;
      const exactB = b.loaders.includes(target.loader) ? 0 : 1;
      if (exactA !== exactB) return exactA - exactB;
    }
    return new Date(b.datePublished).getTime() - new Date(a.datePublished).getTime();
  })[0];
}

/**
 * Version publiee plus recemment que celle retenue.
 *
 * `pickBestVersion` privilegie une release meme si une beta plus recente
 * existe. C'est le bon defaut, mais il faut pouvoir le dire : sans cela, rien
 * ne distingue "derniere version publiee" de "derniere version stable", et
 * l'utilisateur ne peut pas verifier que le choix est delibere.
 */
export function newerThanPicked(
  picked: ProviderVersion,
  pool: ProviderVersion[],
  target: MergeTarget,
  kind: ContentKind = "mod",
): ProviderVersion | null {
  const pickedAt = new Date(picked.datePublished).getTime();
  const candidates = pool.filter(
    (v) =>
      v.versionId !== picked.versionId &&
      v.gameVersions.includes(target.minecraft) &&
      acceptsLoader(v, target, kind) &&
      new Date(v.datePublished).getTime() > pickedAt,
  );
  if (!candidates.length) return null;
  return candidates.sort(
    (a, b) => new Date(b.datePublished).getTime() - new Date(a.datePublished).getTime(),
  )[0];
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

async function findVersions(
  mod: PackMod,
  target: MergeTarget,
): Promise<{ versions: ProviderVersion[]; project?: ProviderProject }> {
  const loaders = LOADER_COMPAT[target.loader];
  const mc = [target.minecraft];

  // 1. le projet est connu : on interroge directement sa source
  if (mod.provider !== "unknown" && mod.projectId) {
    const versions = await providerOf(mod.provider)
      .getVersions(mod.projectId, loaders, mc, mod.kind)
      .catch(() => []);
    if (versions.length) {
      const project =
        (await providerOf(mod.provider).getProject(mod.projectId).catch(() => null)) ?? undefined;
      return { versions, project };
    }
  }

  // 2. le meme mod publie sur l'autre plateforme
  const slug = mod.slug ?? normalizeTitle(mod.name);
  if (mod.provider !== "modrinth" && slug) {
    const versions = await modrinth.getVersions(slug, loaders, mc, mod.kind).catch(() => []);
    if (versions.length) {
      const project = (await modrinth.getProject(slug).catch(() => null)) ?? undefined;
      return { versions, project };
    }
  }

  // 3. recherche par nom, acceptee seulement si le titre correspond vraiment :
  //    mieux vaut declarer un mod introuvable que le remplacer au hasard.
  const wanted = normalizeTitle(mod.name);
  const hits = await modrinth
    .search(mod.name, loaders, target.minecraft, 5, mod.kind)
    .catch(() => []);
  const exact = hits.find((h) => normalizeTitle(h.title) === wanted);
  if (exact) {
    const versions = await modrinth
      .getVersions(exact.projectId, loaders, mc, mod.kind)
      .catch(() => []);
    if (versions.length) return { versions, project: exact };
  }

  if (curseforge.available()) {
    const cfHits = await curseforge
      .search(mod.name, loaders, target.minecraft, 5, mod.kind)
      .catch(() => []);
    const cfExact = cfHits.find((h) => normalizeTitle(h.title) === wanted);
    if (cfExact) {
      const versions = await curseforge
        .getVersions(cfExact.projectId, loaders, mc, mod.kind)
        .catch(() => []);
      if (versions.length) return { versions, project: cfExact };
    }
  }

  return { versions: [] };
}

export async function resolveMod(
  group: DedupedMod,
  target: MergeTarget,
  preferStable = true,
): Promise<ModResolution> {
  const mod = group.primary;
  const base = {
    key: mod.key,
    name: mod.name,
    kind: mod.kind,
    from: mod.from,
    source: mod,
    mergedFrom: group.labels.length > 1 ? group.labels : undefined,
  };

  // Mods qui n'ont de sens que sur certains loaders : leur absence sur la
  // cible est attendue, ce n'est pas un echec.
  const loaderOnly =
    mod.kind === "mod"
      ? (LOADER_ONLY[(mod.slug ?? "").toLowerCase()] ??
        LOADER_ONLY[(mod.modId ?? "").toLowerCase()])
      : undefined;
  if (loaderOnly && !loaderOnly.includes(target.loader)) {
    return {
      ...base,
      status: "excluded",
      reason: `Specifique a ${loaderOnly.join("/")} : inutile sur ${target.loader}, ses fonctions sont fournies par le loader.`,
    };
  }

  const { versions, project } = await findVersions(mod, target);
  const picked = pickBestVersion(versions, target, preferStable, mod.kind);

  if (!picked) {
    return {
      ...base,
      status: "missing",
      project,
      reason:
        mod.kind === "mod"
          ? `Aucune version pour ${target.loader} ${target.minecraft}.`
          : `Aucun ${CONTENT_INFO[mod.kind].label} compatible avec Minecraft ${target.minecraft}.`,
    };
  }

  const unstable = picked.versionType !== "release";
  const viaCompat =
    !picked.loaders.includes(target.loader) &&
    picked.loaders.some((l) => LOADER_COMPAT[target.loader].includes(l as LoaderId));

  const newer = newerThanPicked(picked, versions, target, mod.kind);

  const reasons = [`${picked.versionNumber} (${picked.versionType})`];
  if (viaCompat) reasons.push(`charge via la compatibilite ${picked.loaders[0]} de ${target.loader}`);
  if (unstable) reasons.push("aucune release stable pour cette version");
  if (newer) {
    reasons.push(
      `${newer.versionNumber} est plus recente mais en ${newer.versionType}, donc ecartee`,
    );
  }
  if (group.labels.length > 1) reasons.push(`apporte par les packs ${group.labels.join(", ")}`);

  return {
    ...base,
    status: "ok",
    picked,
    project,
    unstable,
    newerAvailable: newer
      ? {
          versionNumber: newer.versionNumber,
          versionType: newer.versionType,
          datePublished: newer.datePublished,
        }
      : undefined,
    reason: reasons.join(" — "),
  };
}

/**
 * Complete le cote client/serveur manquant, via Modrinth.
 *
 * L'API CurseForge ne dit nulle part si un mod sert au client, au serveur ou
 * aux deux : sans cela, un pack entierement CurseForge repond "tout des deux
 * cotes", ce qui ne renseigne personne. Beaucoup de ces mods sont aussi
 * publies sur Modrinth, qui le declare — et le meme fichier s'y retrouve par
 * son empreinte sha1.
 *
 * Deux requetes pour tout le pack, quel que soit le nombre de mods.
 */
export async function enrichEnvironments(resolutions: ModResolution[]): Promise<void> {
  const inconnus = resolutions.filter(
    (r) =>
      (r.status === "ok" || r.status === "substituted") &&
      r.picked?.hashes.sha1 &&
      r.project?.clientSide === undefined &&
      r.project?.serverSide === undefined,
  );
  if (!inconnus.length) return;

  const parHash = await modrinth
    .lookupByHashes(inconnus.map((r) => r.picked!.hashes.sha1!))
    .catch(() => new Map<string, ProviderVersion>());
  if (!parHash.size) return;

  const projets = await modrinth
    .getProjects([...new Set([...parHash.values()].map((v) => v.projectId))])
    .catch(() => []);
  const parProjet = new Map(projets.map((p) => [p.projectId, p]));

  for (const r of inconnus) {
    const v = parHash.get(r.picked!.hashes.sha1!.toLowerCase());
    const p = v ? parProjet.get(v.projectId) : undefined;
    if (!p) continue;
    // Seul l'environnement est repris : le projet reste celui de sa source,
    // avec son lien et son identifiant d'origine.
    r.project = r.project
      ? { ...r.project, clientSide: p.clientSide, serverSide: p.serverSide }
      : p;
  }
}

export async function resolveAll(
  groups: DedupedMod[],
  target: MergeTarget,
  opts: { preferStable?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<ModResolution[]> {
  const out: ModResolution[] = [];
  const BATCH = 8;
  for (let i = 0; i < groups.length; i += BATCH) {
    const settled = await Promise.all(
      groups.slice(i, i + BATCH).map((g) =>
        resolveMod(g, target, opts.preferStable ?? true).catch(
          (err): ModResolution => ({
            key: g.primary.key,
            name: g.primary.name,
            kind: g.primary.kind,
            from: g.primary.from,
            source: g.primary,
            status: "missing",
            reason: `Erreur lors de la recherche : ${err?.message ?? err}`,
          }),
        ),
      ),
    );
    out.push(...settled);
    opts.onProgress?.(Math.min(i + BATCH, groups.length), groups.length);
  }
  await enrichEnvironments(out).catch(() => {});
  return out;
}
