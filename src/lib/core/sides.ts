import { CONTENT_INFO } from "./content";
import { sideOf, type Side } from "./summary";
import type { EnvSupport, ModResolution } from "./types";

/**
 * Repartition client / serveur.
 *
 * Un client charge les mods d'affichage (minimap, shaders, interface) ; un
 * serveur dedie ne les supporte pas, et certains le font planter au
 * demarrage. A l'inverse, un mod requis cote serveur qui manque fait refuser
 * les joueurs a la connexion. D'ou deux archives distinctes plutot qu'un
 * seul pack pour tout le monde.
 */

export type { Side };

/** Ce que l'utilisateur veut produire. */
export type PackTarget = "client" | "server" | "both";

/** Une archive a produire : destinee au lanceur, ou au dossier du serveur. */
export type Distribution = "client" | "server";

export function distributionsFor(target: PackTarget): Distribution[] {
  return target === "both" ? ["client", "server"] : [target];
}

/**
 * La source dit-elle quelque chose du cote de cet element ?
 *
 * CurseForge ne le declare jamais ; on le recupere par Modrinth quand le
 * meme fichier y existe. Sans cela, le cote est inconnu : l'element part des
 * deux cotes par prudence, et l'utilisateur est invite a trancher.
 */
export function sideIsKnown(r: ModResolution): boolean {
  if (CONTENT_INFO[r.kind].side !== "both") return true;
  const known = (v?: EnvSupport) => v !== undefined && v !== "unknown";
  return (
    (known(r.project?.clientSide) && known(r.project?.serverSide)) ||
    (known(r.source?.env.client) && known(r.source?.env.server))
  );
}

/** Cote retenu : le choix de l'utilisateur, sinon ce que declarent les sources. */
export function effectiveSide(r: ModResolution, overrides: Record<string, Side>): Side {
  return overrides[r.key] ?? sideOf(r);
}

export function includedIn(side: Side, dist: Distribution): boolean {
  return side === "both" || side === dist;
}

const kept = (r: ModResolution) =>
  (r.status === "ok" || r.status === "substituted") && !!r.picked;

/**
 * Resolutions a remettre au generateur pour une archive donnee : les
 * elements de l'autre cote sont retires, le reste est inchange (y compris
 * les elements ecartes, qui figurent au rapport).
 */
export function resolutionsFor(
  resolutions: ModResolution[],
  overrides: Record<string, Side>,
  dist: Distribution,
): ModResolution[] {
  return resolutions.filter((r) => !kept(r) || includedIn(effectiveSide(r, overrides), dist));
}

/**
 * Cote d'un fichier d'instance, d'apres son chemin.
 *
 * Les dossiers client-overrides/ et server-overrides/ le disent
 * explicitement ; pour le reste, certains fichiers n'ont de sens que pour un
 * joueur (reglages video, liste de serveurs, resource packs, shaders).
 */
export function fileSide(path: string): Side {
  if (path.startsWith("client-overrides/")) return "client";
  if (path.startsWith("server-overrides/")) return "server";
  const rel = path.replace(/^overrides\//, "");
  if (
    /^(resourcepacks|shaderpacks|screenshots)\//i.test(rel) ||
    /^(options|optionsof|optionsshaders)\.txt$/i.test(rel) ||
    /^servers\.dat$/i.test(rel)
  ) {
    return "client";
  }
  return "both";
}

/** Champ env d'un .mrpack pour un cote donne. */
export function envFor(side: Side): { client: string; server: string } {
  return {
    client: side === "server" ? "unsupported" : "required",
    server: side === "client" ? "unsupported" : "required",
  };
}
