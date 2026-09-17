export type LoaderId = "fabric" | "forge" | "neoforge" | "quilt";

export const LOADERS: LoaderId[] = ["fabric", "neoforge", "forge", "quilt"];

export const LOADER_LABEL: Record<LoaderId, string> = {
  fabric: "Fabric",
  neoforge: "NeoForge",
  forge: "Forge",
  quilt: "Quilt",
};

/** Loaders dont les mods sont (partiellement) chargeables par le loader cible. */
export const LOADER_COMPAT: Record<LoaderId, LoaderId[]> = {
  fabric: ["fabric"],
  quilt: ["quilt", "fabric"], // Quilt charge les mods Fabric
  neoforge: ["neoforge"],
  forge: ["forge"],
};

export type ProviderId = "modrinth" | "curseforge";
export type PackFormat = "mrpack" | "curseforge" | "raw";
export type EnvSupport = "required" | "optional" | "unsupported" | "unknown";

/**
 * Provenance d'un mod. Les packs sont identifies par leur id de session :
 * l'outil accepte un nombre quelconque d'archives, pas seulement deux.
 */
export type ModSource =
  | { kind: "pack"; packId: string }
  | { kind: "dependency" }
  | { kind: "manual" };

export interface PackMod {
  key: string;
  name: string;
  slug?: string;
  provider: ProviderId | "unknown";
  projectId?: string;
  fileId?: string;
  versionNumber?: string;
  path: string;
  fileName: string;
  fileSize?: number;
  hashes: { sha1?: string; murmur2?: string };
  downloads: string[];
  env: { client: EnvSupport; server: EnvSupport };
  modId?: string;
  required: boolean;
  from: ModSource;
}

export interface ParsedPack {
  id: string;
  /** etiquette courte affichee dans l'UI : A, B, C… */
  label: string;
  format: PackFormat;
  name: string;
  version?: string;
  author?: string;
  summary?: string;
  minecraft?: string;
  loader?: LoaderId;
  loaderVersion?: string;
  mods: PackMod[];
  /** chemins des fichiers d'instance, pour l'apercu seulement */
  overridePaths: string[];
  extraDownloads: PackMod[];
  warnings: string[];
  fileName: string;
  fileSize: number;
}

export interface MergeTarget {
  loader: LoaderId;
  minecraft: string;
  name: string;
  version: string;
  author: string;
}

export interface ProviderVersion {
  provider: ProviderId;
  projectId: string;
  versionId: string;
  name: string;
  versionNumber: string;
  versionType: "release" | "beta" | "alpha";
  datePublished: string;
  loaders: string[];
  gameVersions: string[];
  fileName: string;
  fileSize: number;
  downloadUrl: string | null;
  hashes: { sha1?: string; sha512?: string };
  dependencies: ProviderDependency[];
}

export interface ProviderDependency {
  provider: ProviderId;
  projectId?: string;
  versionId?: string;
  type: "required" | "optional" | "incompatible" | "embedded";
}

export interface ProviderProject {
  provider: ProviderId;
  projectId: string;
  slug: string;
  title: string;
  description: string;
  downloads: number;
  follows?: number;
  iconUrl?: string | null;
  categories: string[];
  loaders: string[];
  gameVersions: string[];
  dateModified?: string;
  clientSide?: EnvSupport;
  serverSide?: EnvSupport;
  url: string;
}

export type ResolutionStatus =
  | "ok"
  | "substituted"
  | "missing"
  | "excluded"
  | "duplicate";

export interface ModResolution {
  key: string;
  name: string;
  from: ModSource;
  status: ResolutionStatus;
  reason: string;
  source?: PackMod;
  picked?: ProviderVersion;
  project?: ProviderProject;
  /** etiquettes des packs qui apportaient ce meme mod */
  mergedFrom?: string[];
  unstable?: boolean;
}

export interface Alternative {
  project: ProviderProject;
  version: ProviderVersion;
  score: number;
  isFork: boolean;
  rationale: string;
  curated: boolean;
}

export interface FunctionalConflict {
  groupId: string;
  groupLabel: string;
  explanation: string;
  members: { key: string; name: string; recommended: boolean; note?: string }[];
  severity: "hard" | "soft";
}

export type OverrideDecision = string; // id de pack gagnant, "merge", "all" ou "skip"

export interface OverrideConflict {
  /** chemin de destination, ex. overrides/config/x.toml */
  path: string;
  /** contributions, une par pack qui fournit ce fichier */
  sides: { packId: string; label: string; size: number }[];
  kind: "text" | "json" | "keyvalue" | "binary";
  mergeable: boolean;
  suggestion: OverrideDecision;
  note?: string;
}

/** Estimation de memoire pour le pack fusionne. */
export interface RamEstimate {
  /** valeur conseillee en Go pour -Xmx, cote client */
  clientGb: number;
  /** idem pour un serveur dedie */
  serverGb: number;
  /** minimum en dessous duquel le pack risque de ne pas demarrer */
  minimumGb: number;
  /** contributions expliquant le calcul */
  breakdown: { label: string; gb: number; detail: string }[];
  /** avertissements (trop de RAM, pack tres lourd, 32 bits…) */
  notes: string[];
  /** arguments JVM conseilles */
  jvmArgs: string;
}
