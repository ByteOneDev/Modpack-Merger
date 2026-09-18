/**
 * Types de contenu d'un modpack.
 *
 * Un pack ne contient pas que des mods : les resource packs, shaders,
 * datapacks et schematiques vivent dans des dossiers differents, s'installent
 * differemment, et ne comptent pas de la meme facon cote client et serveur.
 * Ce module est la seule source de verite sur ces differences ; tout le reste
 * (recherche, parsing, export, recapitulatif) s'y refere.
 */

export type ContentKind =
  | "mod"
  | "resourcepack"
  | "shaderpack"
  | "datapack"
  | "schematic";

export const CONTENT_KINDS: ContentKind[] = [
  "mod",
  "resourcepack",
  "shaderpack",
  "datapack",
  "schematic",
];

export interface ContentKindInfo {
  /** singulier, pour une phrase */
  label: string;
  /** pluriel, pour un onglet ou un compteur */
  plural: string;
  /** dossier de destination dans overrides/ */
  folder: string;
  /** type de projet Modrinth, null si la source ne le propose pas */
  modrinthType: string | null;
  /** classId CurseForge, null si la source ne le propose pas */
  curseforgeClass: number | null;
  /** extensions de fichier reconnues */
  extensions: string[];
  /**
   * Cote ou le contenu sert reellement. Un shader ne sert a rien sur un
   * serveur dedie, un datapack n'a de sens que cote serveur/monde.
   */
  side: "client" | "server" | "both";
  /** une ligne d'explication pour l'interface */
  hint: string;
}

export const CONTENT_INFO: Record<ContentKind, ContentKindInfo> = {
  mod: {
    label: "mod",
    plural: "Mods",
    folder: "mods",
    modrinthType: "mod",
    curseforgeClass: 6,
    extensions: [".jar"],
    side: "both",
    hint: "Le coeur du pack. Chargé par le mod loader au démarrage.",
  },
  resourcepack: {
    label: "resource pack",
    plural: "Resource packs",
    folder: "resourcepacks",
    modrinthType: "resourcepack",
    curseforgeClass: 12,
    extensions: [".zip"],
    side: "client",
    hint: "Textures et sons. Purement visuel : inutile sur un serveur dédié.",
  },
  shaderpack: {
    label: "shader",
    plural: "Shaders",
    folder: "shaderpacks",
    modrinthType: "shader",
    curseforgeClass: 6552,
    extensions: [".zip"],
    side: "client",
    hint: "Rendu graphique. Exige Iris ou OptiFine, et beaucoup de mémoire vidéo.",
  },
  datapack: {
    label: "datapack",
    plural: "Datapacks",
    folder: "datapacks",
    modrinthType: "datapack",
    curseforgeClass: 6945,
    extensions: [".zip"],
    side: "server",
    hint: "Recettes, structures, tables de butin. Appliqué au monde, côté serveur.",
  },
  schematic: {
    label: "schématique",
    plural: "Schématiques",
    folder: "schematics",
    modrinthType: null,
    curseforgeClass: null,
    extensions: [".litematic", ".schem", ".schematic", ".nbt"],
    side: "client",
    hint: "Plans de construction, lus par Litematica, WorldEdit ou Schematica.",
  },
};

/** Mods capables de lire des schematiques, par identifiant de projet connu. */
export const SCHEMATIC_MODS: Record<string, { folder: string; label: string }> = {
  litematica: { folder: "schematics", label: "Litematica" },
  schematica: { folder: "schematics", label: "Schematica" },
  worldedit: { folder: "config/worldedit/schematics", label: "WorldEdit" },
  axiom: { folder: "blueprints", label: "Axiom" },
  "world-edit": { folder: "config/worldedit/schematics", label: "WorldEdit" },
  "litematica-fabric": { folder: "schematics", label: "Litematica" },
  "create-schematics": { folder: "schematics", label: "Create" },
};

/**
 * Deduit le type d'un contenu depuis son chemin dans l'archive.
 * Renvoie null pour un fichier de configuration ordinaire.
 */
export function kindFromPath(path: string): ContentKind | null {
  const p = path.toLowerCase().replace(/^(overrides|client-overrides|server-overrides)\//, "");
  if (/(^|\/)mods\/[^/]+\.jar$/.test(p)) return "mod";
  if (/(^|\/)resourcepacks\//.test(p)) return "resourcepack";
  if (/(^|\/)shaderpacks\//.test(p)) return "shaderpack";
  if (/(^|\/)datapacks\//.test(p)) return "datapack";
  if (/\.(litematic|schem|schematic|nbt)$/.test(p)) return "schematic";
  return null;
}

/** "1 resource pack" / "3 resource packs" : l'accord se fait sur le compte. */
export function countLabel(kind: ContentKind, count: number): string {
  const info = CONTENT_INFO[kind];
  return `${count} ${count > 1 ? info.plural.toLowerCase() : info.label}`;
}

/** Type deduit d'un nom de fichier seul, pour un import manuel. */
export function kindFromFileName(name: string): ContentKind | null {
  const n = name.toLowerCase();
  if (n.endsWith(".jar")) return "mod";
  if (/\.(litematic|schem|schematic|nbt)$/.test(n)) return "schematic";
  return null; // un .zip est ambigu : resource pack, shader ou datapack
}

/** Type deduit des donnees renvoyees par Modrinth. */
export function kindFromModrinthType(
  projectType: string | undefined,
  loaders: string[] = [],
): ContentKind {
  if (projectType === "resourcepack") return "resourcepack";
  if (projectType === "shader") return "shaderpack";
  if (projectType === "datapack") return "datapack";
  // Un projet publie a la fois en mod et en datapack reste un mod tant qu'il
  // expose un vrai loader ; sinon c'est un datapack pur.
  if (loaders.length && loaders.every((l) => l === "datapack")) return "datapack";
  return "mod";
}

/** Type deduit du classId CurseForge. */
export function kindFromCurseforgeClass(classId: number | undefined): ContentKind {
  switch (classId) {
    case 12:
      return "resourcepack";
    case 6552:
      return "shaderpack";
    case 6945:
      return "datapack";
    default:
      return "mod";
  }
}

/**
 * Loaders a demander a Modrinth pour ce type.
 *
 * Un resource pack n'est pas publie sous "fabric" mais sous "minecraft" ; un
 * shader sous "iris"/"optifine". Interroger l'API avec le loader du pack ne
 * renverrait rien.
 */
export function providerLoaders(kind: ContentKind, packLoader: string[]): string[] {
  switch (kind) {
    case "resourcepack":
      return ["minecraft"];
    case "shaderpack":
      return ["iris", "optifine", "canvas", "vanilla"];
    case "datapack":
      return ["datapack"];
    case "schematic":
      return [];
    default:
      return packLoader;
  }
}
