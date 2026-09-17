/**
 * Configuration d'execution des clients d'API.
 *
 * Les modules providers ne sont pas des composants React : ils lisent leur
 * configuration ici, et l'UI la pousse au demarrage puis a chaque changement
 * de reglages.
 */
export interface ProviderConfig {
  /** Relais explicitement renseigne par l'utilisateur (prioritaire). */
  curseforgeProxyUrl: string;
  /** Relais servi par l'hebergement lui-meme, detecte au demarrage. */
  builtInProxyUrl: string;
  /** Relais de telechargement des jars, quand l'hebergement en fournit un. */
  downloadProxyUrl: string;
  curseforgeApiKey: string;
  downloadConcurrency: number;
}

let config: ProviderConfig = {
  curseforgeProxyUrl: "",
  builtInProxyUrl: "",
  downloadProxyUrl: "",
  curseforgeApiKey: "",
  downloadConcurrency: 5,
};

export function setProviderConfig(next: Partial<ProviderConfig>): void {
  config = { ...config, ...next };
}

export function getProviderConfig(): ProviderConfig {
  return config;
}

/**
 * Relais CurseForge effectif. Un relais saisi a la main l'emporte sur celui
 * de l'hebergement : c'est le seul moyen pour l'utilisateur de reprendre la
 * main si le relais integre est en panne ou mal configure.
 */
export function effectiveCurseforgeBase(): string | null {
  const explicit = config.curseforgeProxyUrl.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  if (config.builtInProxyUrl) return config.builtInProxyUrl.replace(/\/+$/, "");
  return null;
}
