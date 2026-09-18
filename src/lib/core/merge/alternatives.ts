import {
  LOADER_COMPAT,
  type Alternative,
  type LoaderId,
  type MergeTarget,
  type ModResolution,
  type ProviderProject,
} from "../types";
import { modrinth, curseforge, searchAll, normalizeTitle } from "../providers";
import { equivalenceFor, detectFork } from "./knowledge";
import { pickBestVersion } from "./resolve";

/**
 * Cherche un remplacant pour un mod absent du loader cible.
 *
 * Deux sources, dans cet ordre :
 *  1. la table d'equivalences curee (Sodium pour OptiFine, Jade pour Waila...) ;
 *  2. une recherche par nom et par categories, notee puis triee.
 *
 * Le classement penalise fortement les forks : ils ne sont proposes en tete
 * que si aucun mod original n'existe sur la cible, et l'UI l'annonce alors
 * explicitement.
 */

const MS_PER_DAY = 86_400_000;

interface Scored {
  project: ProviderProject;
  score: number;
  isFork: boolean;
  forkSignal: string | null;
  curated: boolean;
  parts: string[];
}

function scoreProject(
  project: ProviderProject,
  wanted: string,
  curated: boolean,
  pertinence = 0,
): Scored {
  const { isFork, signal } = detectFork(
    project.title,
    project.description ?? "",
    project.slug,
  );

  let score = 0;
  const parts: string[] = [];

  // Popularite (log : 1k -> ~30, 1M -> ~60, 100M -> ~80)
  const pop = Math.min(40, Math.log10(Math.max(project.downloads, 1)) * 6.5);
  score += pop;
  if (project.downloads >= 1_000_000) {
    parts.push(`${formatDownloads(project.downloads)} telechargements`);
  }

  // Maintenance recente
  if (project.dateModified) {
    const days = (Date.now() - new Date(project.dateModified).getTime()) / MS_PER_DAY;
    if (days < 60) {
      score += 20;
      parts.push("mis a jour recemment");
    } else if (days < 180) {
      score += 12;
    } else if (days < 365) {
      score += 4;
    } else {
      score -= 10;
      parts.push("pas de mise a jour depuis plus d'un an");
    }
  }

  // Ressemblance du nom : c'est le signal le plus fort apres la table curee.
  // Le laisser derriere la popularite faisait remonter n'importe quel mod
  // tres telecharge renvoye par la recherche.
  score += pertinence * 45;
  if (pertinence >= 0.6) parts.push("nom tres proche");

  // Une correspondance curee encode un jugement editorial : elle domine.
  if (curated) {
    score += 45;
    parts.push("equivalent connu");
  }

  // Penalite fork : suffisante pour passer derriere tout mod original viable
  if (isFork) {
    score -= 35;
    parts.push(`fork (${signal})`);
  }

  return {
    project,
    score: Math.max(0, Math.min(100, Math.round(score))),
    isFork,
    forkSignal: signal,
    curated,
    parts,
  };
}

/** Mots trop courants pour dire quoi que ce soit d'un mod. */
const MOTS_VIDES = new Set([
  "mod", "mods", "fabric", "forge", "neoforge", "quilt", "api", "lib", "library",
  "minecraft", "port", "edition", "reforged", "continued", "unofficial", "for",
  "and", "the", "with", "new", "more", "plus",
]);

function jetons(titre: string): Set<string> {
  return new Set(
    titre
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((m) => m.length >= 3 && !MOTS_VIDES.has(m)),
  );
}

/** Coefficient de Dice : 1 si les deux titres portent les memes mots. */
function recouvrement(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let communs = 0;
  for (const mot of a) if (b.has(mot)) communs++;
  return (2 * communs) / (a.size + b.size);
}

/**
 * Marqueurs d'un complement : un addon n'est pas un remplacant.
 *
 * « Refined Storage: Powerless Addon » ou « Aero Islands [for Create
 * Aeronautics] » portent le nom du mod cherche et sortent donc en tete d'une
 * comparaison de titres — alors qu'ils en dependent au lieu de s'y
 * substituer.
 */
const MARQUEURS_COMPLEMENT =
  /\b(add-?ons?|extensions?|compat(?:ibility)?|patch(?:es)?|integrations?|supports?|plugins?|tweaks?|for)\b/i;

function estComplementDe(project: ProviderProject, jetonsVoulus: Set<string>): boolean {
  if (!MARQUEURS_COMPLEMENT.test(project.title)) return false;
  const siens = jetons(project.title);
  for (const mot of jetonsVoulus) if (siens.has(mot)) return true;
  return false;
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1000) return `${Math.round(n / 1000)} k`;
  return String(n);
}

export async function findAlternatives(
  resolution: ModResolution,
  target: MergeTarget,
  limit = 6,
): Promise<{ alternatives: Alternative[]; note: string | null }> {
  const mod = resolution.source;
  const name = resolution.name;
  const loaders = LOADER_COMPAT[target.loader];
  const wanted = normalizeTitle(name);

  const candidates = new Map<string, Scored>();

  // 1. equivalences curees
  const eq = equivalenceFor(mod?.slug, mod?.modId, normalizeTitle(name), name);
  let curatedNote: string | null = null;

  if (eq) {
    curatedNote = eq.why;
    const preferred = [
      ...(eq.prefer[target.loader] ?? []),
      ...(eq.also?.[target.loader] ?? []),
    ];
    const fetched = await Promise.all(
      preferred.map((slug) => modrinth.getProject(slug).catch(() => null)),
    );
    for (const p of fetched) {
      if (!p) continue;
      if (normalizeTitle(p.title) === wanted) continue; // c'est le mod lui-meme
      candidates.set(p.projectId, scoreProject(p, wanted, true, 1));
    }
  }

  // 2. recherche textuelle sur les deux plateformes
  //
  // La recherche renvoie beaucoup de bruit : sur « Create », les deux
  // plateformes proposent des dizaines de mods sans rapport. Un candidat
  // n'est retenu que s'il porte vraiment le nom du mod cherche — sans quoi
  // une proposition « convaincante » n'est qu'un mod populaire pris au hasard.
  const jetonsVoulus = jetons(name);

  // Un nom d'un seul mot ne discrimine rien : « Create » se retrouve dans
  // « F**k Create World », qui n'en est pas un remplacant. Dans ce cas on
  // exige un titre quasi identique ; un vrai remplacant d'un mod au nom court
  // est de toute facon un portage du meme nom.
  const PERTINENCE_MIN = jetonsVoulus.size <= 1 ? 0.8 : 0.34;

  const queries = [name];
  if (eq) queries.push(eq.label);
  const searched = await Promise.all(
    queries.map((q) => searchAll(q, loaders, target.minecraft, 12).catch(() => [])),
  );
  for (const p of searched.flat()) {
    if (candidates.has(p.projectId)) continue;
    if (normalizeTitle(p.title) === wanted && p.provider === mod?.provider) continue;
    if (estComplementDe(p, jetonsVoulus)) continue;

    const pertinence = recouvrement(jetons(p.title), jetonsVoulus);
    if (pertinence < PERTINENCE_MIN) continue;
    candidates.set(p.projectId, scoreProject(p, wanted, false, pertinence));
  }

  // 3. on ne propose que ce qui existe vraiment sur la cible : chaque
  //    candidat doit avoir une version installable, sinon il est ecarte.
  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score);
  const alternatives: Alternative[] = [];

  for (const cand of ranked) {
    if (alternatives.length >= limit) break;
    const versions = await (cand.project.provider === "modrinth"
      ? modrinth
      : curseforge
    )
      .getVersions(cand.project.projectId, loaders, [target.minecraft])
      .catch(() => []);
    const version = pickBestVersion(versions, target);
    if (!version) continue;

    const rationale = buildRationale(cand, version.versionType, target.loader);
    alternatives.push({
      project: cand.project,
      version,
      score: cand.score,
      isFork: cand.isFork,
      rationale,
      curated: cand.curated,
    });
  }

  if (!alternatives.length) {
    return {
      alternatives: [],
      note:
        "Aucun remplacant convaincant. Les mods proches par le nom n'ont pas de " +
        "version installable ici, et rien d'autre ne couvre la meme fonction : " +
        `${name} est a retirer, ou a recuperer en changeant de cible.`,
    };
  }

  // Si tout ce qui reste est un fork, on le dit clairement.
  const onlyForks = alternatives.every((a) => a.isFork);
  const note = onlyForks
    ? "Aucun mod original ne couvre cette fonction sur la configuration cible. " +
      "Les propositions ci-dessous sont toutes des forks : elles fonctionnent, " +
      "mais leur maintenance depend d'un mainteneur tiers."
    : curatedNote;

  return { alternatives, note };
}

function buildRationale(
  cand: Scored,
  versionType: string,
  loader: LoaderId,
): string {
  const bits = [...cand.parts];
  if (versionType !== "release") {
    bits.push(`seulement en ${versionType} sur ${loader}`);
  } else {
    bits.push(`release stable sur ${loader}`);
  }
  return bits.join(", ") || "compatible avec la configuration cible";
}
