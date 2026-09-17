import type { LoaderId } from "../types";

/**
 * Table d'equivalences curee.
 *
 * Elle repond a la question "ce mod n'existe pas sur le loader cible, quel
 * mod stable fait la meme chose ?". Une correspondance curee prime toujours
 * sur une recherche textuelle, parce qu'elle encode un jugement que la
 * recherche ne peut pas retrouver (Sodium n'a pas "OptiFine" dans son nom).
 *
 * `identity` regroupe les mods interchangeables. `prefer` donne, par loader,
 * le remplacant recommande ; `also` liste des compagnons a ajouter pour
 * couvrir les memes fonctionnalites (OptiFine = rendu + shaders).
 */
export interface Equivalence {
  id: string;
  label: string;
  /** slugs / modIds reconnus comme membres de cette famille */
  identity: string[];
  prefer: Partial<Record<LoaderId, string[]>>;
  /** compagnons a proposer en plus du remplacant principal */
  also?: Partial<Record<LoaderId, string[]>>;
  why: string;
}

export const EQUIVALENCES: Equivalence[] = [
  {
    id: "item-viewer",
    label: "Visualiseur de recettes",
    identity: ["jei", "roughly-enough-items", "rei", "emi", "just-enough-items"],
    prefer: {
      fabric: ["emi", "roughly-enough-items", "jei"],
      quilt: ["emi", "roughly-enough-items", "jei"],
      neoforge: ["jei", "emi", "roughly-enough-items"],
      forge: ["jei", "emi", "roughly-enough-items"],
    },
    why: "JEI, REI et EMI remplissent le meme role ; le plus stable sur le loader cible est propose.",
  },
  {
    id: "renderer",
    label: "Moteur de rendu optimise",
    identity: [
      "optifine",
      "sodium",
      "rubidium",
      "magnesium",
      "embeddium",
      "canvas",
    ],
    prefer: {
      fabric: ["sodium"],
      quilt: ["sodium"],
      neoforge: ["sodium", "embeddium"],
      forge: ["embeddium", "rubidium"],
    },
    also: {
      fabric: ["iris", "sodium-extra"],
      quilt: ["iris", "sodium-extra"],
      neoforge: ["iris"],
      forge: ["oculus"],
    },
    why: "OptiFine n'a pas d'equivalent direct : le rendu passe par Sodium/Embeddium et les shaders par Iris/Oculus.",
  },
  {
    id: "shaders",
    label: "Chargeur de shaders",
    identity: ["iris", "oculus", "optifine"],
    prefer: {
      fabric: ["iris"],
      quilt: ["iris"],
      neoforge: ["iris"],
      forge: ["oculus"],
    },
    why: "Iris est le chargeur de shaders de reference ; Oculus en est le portage Forge maintenu.",
  },
  {
    id: "light-engine",
    label: "Moteur d'eclairage",
    identity: ["phosphor", "starlight"],
    prefer: { fabric: ["starlight"], quilt: ["starlight"], forge: ["starlight"] },
    why: "Phosphor n'est plus maintenu, Starlight le remplace sur les deux ecosystemes.",
  },
  {
    id: "optimization-lib",
    label: "Optimisations serveur",
    identity: ["lithium", "canary", "radium"],
    prefer: {
      fabric: ["lithium"],
      quilt: ["lithium"],
      neoforge: ["canary", "lithium"],
      forge: ["canary"],
    },
    why: "Canary est le portage Forge/NeoForge officiel des optimisations de Lithium.",
  },
  {
    id: "tooltip-probe",
    label: "Infos sur le bloc vise",
    identity: ["jade", "the-one-probe", "waila", "hwyla", "wthit"],
    prefer: {
      fabric: ["jade", "wthit"],
      quilt: ["jade", "wthit"],
      neoforge: ["jade", "the-one-probe"],
      forge: ["jade", "the-one-probe"],
    },
    why: "Waila et Hwyla sont abandonnes ; Jade est leur successeur actif sur tous les loaders.",
  },
  {
    id: "minimap",
    label: "Minimap",
    identity: [
      "journeymap",
      "xaeros-minimap",
      "xaerominimap",
      "voxelmap",
      "antique-atlas",
    ],
    prefer: {
      fabric: ["xaeros-minimap", "journeymap"],
      quilt: ["xaeros-minimap", "journeymap"],
      neoforge: ["journeymap", "xaeros-minimap"],
      forge: ["journeymap", "xaeros-minimap"],
    },
    why: "JourneyMap et Xaero's couvrent les memes usages et existent sur tous les loaders.",
  },
  {
    id: "inventory-sort",
    label: "Tri d'inventaire",
    identity: [
      "mouse-tweaks",
      "mousewheelie",
      "mouse-wheelie",
      "inventory-profiles-next",
      "inventory-tweaks",
      "itemswapper",
    ],
    prefer: {
      fabric: ["inventory-profiles-next", "mouse-wheelie"],
      quilt: ["inventory-profiles-next", "mouse-wheelie"],
      neoforge: ["mouse-tweaks", "inventory-profiles-next"],
      forge: ["mouse-tweaks", "inventory-profiles-next"],
    },
    why: "Mouse Tweaks (Forge) et Mouse Wheelie (Fabric) sont les equivalents historiques l'un de l'autre.",
  },
  {
    id: "dynamic-lights",
    label: "Lumieres dynamiques",
    identity: ["lambdynamiclights", "dynamiclights", "dynamic-lights", "optifine"],
    prefer: {
      fabric: ["lambdynamiclights"],
      quilt: ["lambdynamiclights"],
      neoforge: ["dynamiclights-reforged", "sodium-dynamic-lights"],
      forge: ["dynamiclights-reforged"],
    },
    why: "Fonction integree a OptiFine, fournie par un mod dedie sur Sodium/Embeddium.",
  },
  {
    id: "ctm",
    label: "Textures connectees",
    identity: ["continuity", "ctm", "connectedness", "athena"],
    prefer: {
      fabric: ["continuity"],
      quilt: ["continuity"],
      neoforge: ["athena", "ctm"],
      forge: ["ctm", "athena"],
    },
    why: "Continuity (Fabric) et CTM/Athena (Forge) lisent les memes formats de textures connectees.",
  },
  {
    id: "zoom",
    label: "Zoom",
    identity: ["zoomify", "ok-zoomer", "logical-zoom", "wi-zoom", "optifine"],
    prefer: {
      fabric: ["zoomify", "ok-zoomer"],
      quilt: ["zoomify", "ok-zoomer"],
      neoforge: ["zoomify", "logical-zoom"],
      forge: ["logical-zoom"],
    },
    why: "Le zoom d'OptiFine est fourni par un petit mod dedie sur les autres configurations.",
  },
  {
    id: "config-lib",
    label: "Bibliotheque de configuration",
    identity: ["cloth-config", "forge-config-api-port"],
    prefer: {
      fabric: ["cloth-config"],
      quilt: ["cloth-config"],
      neoforge: ["forge-config-api-port", "cloth-config"],
      forge: ["forge-config-api-port", "cloth-config"],
    },
    why: "Forge Config API Port est le pendant Forge/NeoForge de Cloth Config.",
  },
  {
    id: "mod-list-ui",
    label: "Ecran de liste des mods",
    identity: ["modmenu", "mod-menu", "catalogue"],
    prefer: {
      fabric: ["modmenu"],
      quilt: ["modmenu"],
      neoforge: ["catalogue"],
      forge: ["catalogue"],
    },
    why: "Forge/NeoForge ont un ecran de mods integre ; Catalogue reproduit le confort de Mod Menu.",
  },
  {
    id: "lib-core",
    label: "Bibliotheque du loader",
    identity: ["fabric-api", "quilted-fabric-api", "forgified-fabric-api"],
    prefer: {
      fabric: ["fabric-api"],
      quilt: ["qsl", "quilted-fabric-api", "fabric-api"],
      neoforge: [],
      forge: [],
    },
    why: "Fabric API n'a pas d'equivalent Forge : ses fonctions sont deja dans le loader.",
  },
];

/** Index inverse slug -> equivalence, construit une fois. */
const BY_IDENTITY = new Map<string, Equivalence>();
for (const eq of EQUIVALENCES) {
  for (const id of eq.identity) BY_IDENTITY.set(id, eq);
}

export function equivalenceFor(...keys: (string | undefined)[]): Equivalence | null {
  for (const k of keys) {
    if (!k) continue;
    const norm = k.toLowerCase().replace(/[\s_]+/g, "-");
    const hit = BY_IDENTITY.get(norm);
    if (hit) return hit;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Conflits fonctionnels                                               */
/* ------------------------------------------------------------------ */

export interface ConflictGroup {
  id: string;
  label: string;
  members: string[];
  /** hard = plantage ou doublon total ; soft = redondance genante */
  severity: "hard" | "soft";
  explanation: string;
  /** ordre de preference quand il faut en garder un seul */
  preference?: string[];
}

export const CONFLICT_GROUPS: ConflictGroup[] = [
  {
    id: "item-viewer",
    label: "Visualiseurs de recettes",
    members: ["jei", "just-enough-items", "roughly-enough-items", "rei", "emi"],
    severity: "soft",
    explanation:
      "Deux visualiseurs de recettes affichent la meme chose et se disputent la place a l'ecran. En garder un seul.",
    preference: ["emi", "jei", "roughly-enough-items"],
  },
  {
    id: "renderer",
    label: "Moteurs de rendu",
    members: ["sodium", "rubidium", "embeddium", "magnesium", "optifine", "canvas"],
    severity: "hard",
    explanation:
      "Ces mods reecrivent tous le moteur de rendu. En charger deux provoque un crash au demarrage.",
    preference: ["sodium", "embeddium", "rubidium"],
  },
  {
    id: "shaders",
    label: "Chargeurs de shaders",
    members: ["iris", "oculus", "optifine", "canvas"],
    severity: "hard",
    explanation: "Un seul chargeur de shaders peut s'attacher au pipeline de rendu.",
    preference: ["iris", "oculus"],
  },
  {
    id: "light-engine",
    label: "Moteurs d'eclairage",
    members: ["phosphor", "starlight"],
    severity: "hard",
    explanation:
      "Starlight et Phosphor remplacent tous deux le moteur de lumiere : incompatibles entre eux.",
    preference: ["starlight"],
  },
  {
    id: "optimization-lib",
    label: "Optimisations du moteur de jeu",
    members: ["lithium", "canary", "radium"],
    severity: "hard",
    explanation:
      "Canary et Radium sont des portages de Lithium : les charger ensemble duplique les memes patchs.",
    preference: ["lithium", "canary"],
  },
  {
    id: "minimap",
    label: "Minimaps",
    members: ["journeymap", "xaeros-minimap", "voxelmap", "antique-atlas", "ftb-chunks"],
    severity: "soft",
    explanation:
      "Plusieurs minimaps se superposent dans le HUD et indexent le monde en double (impact disque et CPU).",
    preference: ["journeymap", "xaeros-minimap"],
  },
  {
    id: "probe",
    label: "Infobulles de bloc",
    members: ["jade", "the-one-probe", "waila", "hwyla", "wthit"],
    severity: "soft",
    explanation: "Deux overlays d'information sur le bloc vise se chevauchent a l'ecran.",
    preference: ["jade", "the-one-probe"],
  },
  {
    id: "dynamic-lights",
    label: "Lumieres dynamiques",
    members: ["lambdynamiclights", "dynamiclights-reforged", "sodium-dynamic-lights"],
    severity: "hard",
    explanation: "Deux implementations de lumiere dynamique provoquent un scintillement permanent.",
    preference: ["lambdynamiclights"],
  },
  {
    id: "backpacks",
    label: "Systemes de sacs a dos",
    members: [
      "sophisticated-backpacks",
      "travelers-backpack",
      "useful-backpacks",
      "iron-backpacks",
    ],
    severity: "soft",
    explanation:
      "Plusieurs systemes de sacs a dos font doublon dans la progression et encombrent le JEI.",
    preference: ["sophisticated-backpacks", "travelers-backpack"],
  },
  {
    id: "inventory-sort",
    label: "Tri d'inventaire",
    members: [
      "mouse-tweaks",
      "mouse-wheelie",
      "mousewheelie",
      "inventory-profiles-next",
      "inventory-tweaks",
    ],
    severity: "soft",
    explanation:
      "Deux mods de tri se disputent les memes raccourcis souris : les clics deviennent imprevisibles.",
    preference: ["inventory-profiles-next", "mouse-tweaks"],
  },
  {
    id: "zoom",
    label: "Mods de zoom",
    members: ["zoomify", "ok-zoomer", "logical-zoom", "wi-zoom"],
    severity: "soft",
    explanation: "Plusieurs zooms lies a la meme touche par defaut (C).",
    preference: ["zoomify", "ok-zoomer"],
  },
  {
    id: "worldgen-overhaul",
    label: "Refontes de generation du monde",
    members: ["terralith", "biomes-o-plenty", "biomesoplenty", "oh-the-biomes-youll-go", "byg", "tectonic", "william-wythers-overhauled-overworld"],
    severity: "soft",
    explanation:
      "Deux refontes de biomes se melangent : transitions incoherentes et biomes ecrases. Elles peuvent coexister mais demandent un datapack de compatibilite.",
  },
  {
    id: "chunk-claim",
    label: "Protection de zones",
    members: ["ftb-chunks", "open-parties-and-claims", "flan", "griefdefender"],
    severity: "soft",
    explanation: "Deux systemes de claims concurrents : les protections ne se voient pas entre elles.",
  },
];

/* ------------------------------------------------------------------ */
/* Detection de forks                                                  */
/* ------------------------------------------------------------------ */

const FORK_TITLE_PATTERNS = [
  /\bfork\b/i,
  /\bunofficial\b/i,
  /\breforged\b/i,
  /\brefabricated\b/i,
  /\bcontinued\b/i,
  /\brevived\b/i,
  /\brebirth\b/i,
  /\bresurrect(ed)?\b/i,
  /\b(un)?official\s+port\b/i,
  /\bport\s+of\b/i,
  /\bbackport\b/i,
  /\bcommunity\s+edition\b/i,
  /\bredux\b/i,
];

const FORK_DESC_PATTERNS = [
  /\bfork of\b/i,
  /\bunofficial (port|fork|continuation)\b/i,
  /\ba port of\b/i,
  /\bcontinuation of\b/i,
  /\bmaintained fork\b/i,
];

const FORK_SLUG_SUFFIXES = [
  "-fork",
  "-unofficial",
  "-reforged",
  "-refabricated",
  "-continued",
  "-revived",
  "-port",
  "-forge-port",
  "-fabric-port",
  "-neoforge",
  "-community",
];

export function detectFork(
  title: string,
  description: string,
  slug: string,
): { isFork: boolean; signal: string | null } {
  for (const re of FORK_TITLE_PATTERNS) {
    const m = re.exec(title);
    if (m) return { isFork: true, signal: `titre : "${m[0]}"` };
  }
  for (const re of FORK_DESC_PATTERNS) {
    const m = re.exec(description);
    if (m) return { isFork: true, signal: `description : "${m[0]}"` };
  }
  const s = slug.toLowerCase();
  for (const suffix of FORK_SLUG_SUFFIXES) {
    if (s.endsWith(suffix)) return { isFork: true, signal: `slug "${suffix}"` };
  }
  return { isFork: false, signal: null };
}

/** Mods dont l'absence sur le loader cible est normale, pas un probleme. */
export const LOADER_ONLY: Record<string, LoaderId[]> = {
  "fabric-api": ["fabric", "quilt"],
  qsl: ["quilt"],
  "quilted-fabric-api": ["quilt"],
  modmenu: ["fabric", "quilt"],
  "fabric-language-kotlin": ["fabric", "quilt"],
  kotlinforforge: ["forge", "neoforge"],
  "forge-config-api-port": ["forge", "neoforge", "fabric", "quilt"],
};

/* ------------------------------------------------------------------ */
/* Profil memoire                                                      */
/* ------------------------------------------------------------------ */

/**
 * Mods dont le cout memoire s'ecarte nettement de la moyenne.
 *
 * `gb` est le supplement (ou l'economie, s'il est negatif) attribue au mod
 * en plus du cout moyen deja compte par mod. Les valeurs viennent des
 * recommandations publiees par les packs qui embarquent ces mods.
 */
export const MEMORY_PROFILE: { match: string[]; gb: number; why: string }[] = [
  { match: ["gregtech", "gtceu", "gregtechceu"], gb: 1.5, why: "GregTech genere des milliers de recettes en memoire" },
  { match: ["create"], gb: 0.4, why: "Create garde les contraptions en memoire" },
  { match: ["immersiveengineering"], gb: 0.3, why: "multiblocs et rendus lourds" },
  { match: ["ae2", "appliedenergistics2"], gb: 0.3, why: "reseaux et cellules de stockage" },
  { match: ["refinedstorage"], gb: 0.3, why: "indexation du stockage" },
  { match: ["terralith", "biomesoplenty", "biomes-o-plenty", "byg", "oh-the-biomes-youll-go", "tectonic", "william-wythers-overhauled-overworld"], gb: 0.6, why: "generation de monde etendue : plus de chunks en cache" },
  { match: ["kubejs"], gb: 0.2, why: "moteur de scripts charge au demarrage" },
  { match: ["ftbquests", "ftb-quests", "heracles"], gb: 0.2, why: "arbres de quetes charges en memoire" },
  { match: ["distanthorizons"], gb: 1.0, why: "Distant Horizons met en cache un terrain tres etendu" },
  { match: ["bliss", "complementary", "photon", "seus"], gb: 0.5, why: "shaders : buffers graphiques supplementaires" },
  { match: ["pehkui", "supplementaries"], gb: 0.1, why: "cout modere" },
  // Mods qui font gagner de la memoire
  { match: ["ferritecore", "ferrite-core"], gb: -0.5, why: "FerriteCore reduit fortement l'empreinte des blockstates" },
  { match: ["modernfix"], gb: -0.4, why: "ModernFix allege le chargement et le cache" },
  { match: ["memoryleakfix", "memory-leak-fix"], gb: -0.2, why: "corrige des fuites memoire connues" },
  { match: ["lithium", "canary"], gb: -0.1, why: "optimisations du moteur de jeu" },
  { match: ["sodium", "embeddium", "rubidium"], gb: -0.2, why: "moteur de rendu plus econome que le rendu vanilla" },
];

/** Categories Modrinth qui pesent sur la memoire. */
export const HEAVY_CATEGORIES: Record<string, { gb: number; why: string }> = {
  worldgen: { gb: 0.3, why: "generation de monde" },
  technology: { gb: 0.2, why: "mods techniques : beaucoup de blocs-entites" },
  magic: { gb: 0.1, why: "mods magiques" },
};
