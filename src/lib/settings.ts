"use client";

/**
 * Reglages utilisateur, conserves dans le navigateur.
 *
 * L'app etant statique, il n'y a pas de serveur ou stocker quoi que ce soit :
 * tout vit dans localStorage, sur la machine de l'utilisateur.
 */

export interface Settings {
  theme: "system" | "light" | "dark";
  /**
   * URL d'un proxy CurseForge. L'API CurseForge exige une cle secrete et
   * n'autorise pas les appels depuis un navigateur : un site statique ne peut
   * donc pas l'interroger directement. Le proxy detient la cle et relaie.
   */
  curseforgeProxyUrl: string;
  /** Cle transmise au proxy s'il attend que le client la fournisse. */
  curseforgeApiKey: string;
  /** Preferer une version stable meme si une beta plus recente existe. */
  preferStable: boolean;
  /** Ajouter automatiquement les dependances requises manquantes. */
  autoDependencies: boolean;
  /** Signaler les mods qui font doublon fonctionnel. */
  detectFunctionalConflicts: boolean;
  /** Format d'export par defaut. */
  defaultExportFormat: "mrpack" | "curseforge";
  /** Embarquer les jars dans l'archive plutot que de lister des liens. */
  defaultBundleJars: boolean;
  /** Nombre de telechargements simultanes lors de l'export complet. */
  downloadConcurrency: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  curseforgeProxyUrl: "",
  curseforgeApiKey: "",
  preferStable: true,
  autoDependencies: true,
  detectFunctionalConflicts: true,
  defaultExportFormat: "mrpack",
  defaultBundleJars: true,
  downloadConcurrency: 5,
};

const KEY = "modpack-merger.settings.v1";

export function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* mode navigation privee : les reglages ne survivront pas a la session */
  }
  applyTheme(s.theme);
  notifyProviders(s);
}

export function applyTheme(theme: Settings["theme"]): void {
  if (typeof document === "undefined") return;
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/* ------------------------------------------------------------------ */
/* Pont vers la couche providers, qui n'est pas un composant React      */
/* ------------------------------------------------------------------ */

type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();

export function onSettingsChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyProviders(s: Settings) {
  for (const fn of listeners) fn(s);
}
