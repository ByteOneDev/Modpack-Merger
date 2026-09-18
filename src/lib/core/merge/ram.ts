import type { ModResolution, RamEstimate } from "../types";
import { MEMORY_PROFILE, HEAVY_CATEGORIES } from "./knowledge";
import { normalizeTitle } from "../providers";

/**
 * Estimation de la memoire a allouer au pack fusionne.
 *
 * Le chiffre est construit a partir de signaux reels du pack — version de
 * Minecraft, nombre de mods, presence de mods connus pour leur appetit ou au
 * contraire pour leurs optimisations — et non d'une regle unique par mod.
 * Cela reste une estimation : c'est indique dans les notes, et le detail du
 * calcul est expose pour que l'utilisateur puisse juger.
 */

/**
 * Cout de base du jeu seul, selon la version : ce qu'il faut pour jouer
 * confortablement en vanilla, distance d'affichage par defaut.
 */
function baseGb(minecraft: string): { gb: number; label: string } {
  const m = /^1\.(\d+)/.exec(minecraft);
  if (!m) {
    // Versions calendaires (26.x et suivantes) : moteur plus gourmand
    return { gb: 2.2, label: `Minecraft ${minecraft}` };
  }
  const minor = Number(m[1]);
  if (minor < 16) return { gb: 1.0, label: `Minecraft ${minecraft}` };
  if (minor < 18) return { gb: 1.4, label: `Minecraft ${minecraft}` };
  if (minor < 21) return { gb: 1.8, label: `Minecraft ${minecraft}` };
  return { gb: 2.0, label: `Minecraft ${minecraft}` };
}

/**
 * Cout moyen par mod, degressif : les bibliotheques sont mutualisees et le
 * cout marginal d'un mod supplementaire baisse. Cale sur les recommandations
 * usuelles : ~50 mods -> 4 Go, ~150 -> 6 Go, ~250 -> 8 Go.
 */
function perModGb(count: number): number {
  const first = Math.min(count, 100) * 0.02;
  const next = Math.max(0, Math.min(count - 100, 150)) * 0.014;
  const rest = Math.max(0, count - 250) * 0.01;
  return first + next + rest;
}

function identityKeys(r: ModResolution): string[] {
  const out = new Set<string>();
  const push = (v?: string) => {
    if (v) out.add(v.toLowerCase().replace(/[\s_]+/g, "-"));
  };
  push(r.project?.slug);
  push(r.source?.slug);
  push(r.source?.modId);
  push(normalizeTitle(r.name));
  return [...out].filter(Boolean);
}

function matches(keys: string[], needle: string): boolean {
  const n = needle.toLowerCase();
  const compact = n.replace(/-/g, "");
  return keys.some((k) => k === n || k.replace(/-/g, "") === compact);
}

export function estimateRam(
  resolutions: ModResolution[],
  minecraft: string,
  opts: { hasShaders?: boolean; hasResourcePacks?: boolean } = {},
): RamEstimate {
  const all = resolutions.filter((r) => r.status === "ok" || r.status === "substituted");
  // Seuls les mods sont charges par la JVM. Un resource pack pese sur la
  // memoire video, un datapack sur le serveur, une schematique sur rien du
  // tout : les compter comme des mods gonflerait l'estimation pour rien.
  const kept = all.filter((r) => r.kind === "mod");
  const count = kept.length;

  // Le contenu ajoute au pack compte au meme titre que celui trouve dans les
  // archives : un shader reste un shader d'ou qu'il vienne.
  const hasShaders = opts.hasShaders || all.some((r) => r.kind === "shaderpack");
  const hasResourcePacks = opts.hasResourcePacks || all.some((r) => r.kind === "resourcepack");

  const breakdown: RamEstimate["breakdown"] = [];
  const notes: string[] = [];

  const base = baseGb(minecraft);
  breakdown.push({
    label: "Jeu de base",
    gb: base.gb,
    detail: `${base.label}, sans mods`,
  });

  const mods = perModGb(count);
  breakdown.push({
    label: `${count} mods`,
    gb: round2(mods),
    detail: "cout moyen degressif : les bibliotheques partagees sont mutualisees",
  });

  // Mods au profil memoire particulier : les surcouts et les economies sont
  // sommes separement pour que le detail affiche reste lisible.
  let heavyGb = 0;
  let saverGb = 0;
  const heavy: string[] = [];
  const savers: string[] = [];

  for (const r of kept) {
    const keys = identityKeys(r);
    const hit = MEMORY_PROFILE.find((p) => p.match.some((m) => matches(keys, m)));
    if (!hit) continue;
    if (hit.gb > 0) {
      heavyGb += hit.gb;
      heavy.push(`${r.name} (+${hit.gb} Go : ${hit.why})`);
    } else {
      saverGb += hit.gb;
      savers.push(`${r.name} (${hit.gb} Go : ${hit.why})`);
    }
  }
  // FerriteCore et consorts economisent d'autant plus qu'il y a de contenu a
  // dedupliquer : appliquer leur gain a taux plein sur un pack de 20 mods
  // surestimerait largement leur effet.
  const saverScale = Math.min(1, count / 100);
  const scaledSaverGb = saverGb * saverScale;
  const specialGb = heavyGb + scaledSaverGb;

  if (heavy.length) {
    breakdown.push({
      label: "Mods gourmands",
      gb: round2(heavyGb),
      detail:
        heavy.slice(0, 4).join(" · ") +
        (heavy.length > 4 ? ` · et ${heavy.length - 4} autres` : ""),
    });
  }
  if (savers.length) {
    breakdown.push({
      label: "Optimisations presentes",
      gb: round2(scaledSaverGb),
      detail:
        savers.slice(0, 4).join(" · ") +
        (savers.length > 4 ? ` · et ${savers.length - 4} autres` : "") +
        (saverScale < 1
          ? ` · gain reduit : leur effet grandit avec la taille du pack`
          : ""),
    });
  }

  // Categories lourdes, comptees une seule fois chacune
  let categoryGb = 0;
  const categoriesSeen = new Set<string>();
  for (const r of kept) {
    for (const c of r.project?.categories ?? []) {
      const heavy = HEAVY_CATEGORIES[c];
      if (heavy && !categoriesSeen.has(c)) {
        categoriesSeen.add(c);
        categoryGb += heavy.gb;
      }
    }
  }
  if (categoryGb > 0) {
    breakdown.push({
      label: "Familles de mods",
      gb: round2(categoryGb),
      detail: [...categoriesSeen]
        .map((c) => HEAVY_CATEGORIES[c].why)
        .join(" · "),
    });
  }

  let clientExtra = 0;
  if (hasShaders) {
    clientExtra += 1.5;
    breakdown.push({
      label: "Shaders inclus",
      gb: 1.5,
      detail: "buffers graphiques supplementaires, cote client uniquement",
    });
  }
  if (hasResourcePacks) {
    clientExtra += 0.5;
    breakdown.push({
      label: "Packs de ressources",
      gb: 0.5,
      detail: "textures haute resolution en memoire, cote client uniquement",
    });
  }

  const rawClient = base.gb + mods + specialGb + categoryGb + clientExtra;
  // Le serveur ne rend rien : pas de shaders, pas de textures, moins de cache.
  const rawServer = base.gb * 0.75 + mods * 0.8 + specialGb + categoryGb;

  // La marge de 25 % absorbe les pics : exploration de nouveaux chunks,
  // ouverture d'un grand inventaire, rechargement de ressources.
  const clientGb = clamp(roundHalf(rawClient * 1.25), 2, 16);
  const serverGb = clamp(roundHalf(rawServer * 1.2), 1.5, 16);
  const minimumGb = clamp(roundHalf(rawClient), 2, 16);

  notes.push(
    "Estimation indicative : la consommation reelle depend de la distance " +
      "d'affichage, du nombre de chunks explores et de la duree de la session.",
  );
  if (count > 250) {
    notes.push(
      `${count} mods est un tres gros pack : prevois aussi du temps de demarrage ` +
        "(plusieurs minutes) et un disque rapide.",
    );
  }
  if (clientGb >= 10) {
    notes.push(
      "Au-dela de 10 Go, allouer davantage devient contre-productif : les pauses " +
        "du ramasse-miettes s'allongent et le jeu saccade. Mieux vaut retirer des mods.",
    );
  }
  if (!savers.length && count > 80) {
    notes.push(
      "Aucun mod d'optimisation memoire detecte. Ajouter FerriteCore et ModernFix " +
        "ferait baisser ce besoin de plusieurs centaines de Mo.",
    );
  }
  notes.push(
    "N'alloue jamais toute la RAM de ta machine : le systeme et Java lui-meme " +
      "ont besoin de 2 a 3 Go en plus.",
  );

  return {
    clientGb,
    serverGb,
    minimumGb,
    breakdown,
    notes,
    jvmArgs: jvmArgs(clientGb),
  };
}

/**
 * Arguments JVM conseilles. G1GC avec une cible de pause courte est le
 * reglage qui convient a la quasi-totalite des packs sur Java 17+.
 */
function jvmArgs(gb: number): string {
  const xmx = gb % 1 === 0 ? `${gb}G` : `${Math.round(gb * 1024)}M`;
  return [
    `-Xmx${xmx}`,
    `-Xms${xmx}`,
    "-XX:+UseG1GC",
    "-XX:MaxGCPauseMillis=50",
    "-XX:G1HeapRegionSize=16M",
    "-XX:+ParallelRefProcEnabled",
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:+DisableExplicitGC",
    "-XX:+AlwaysPreTouch",
  ].join(" ");
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const roundHalf = (n: number) => Math.round(n * 2) / 2;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
