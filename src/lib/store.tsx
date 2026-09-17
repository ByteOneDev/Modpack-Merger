"use client";

import * as React from "react";
import { set as idbSet, get as idbGet, del as idbDel } from "idb-keyval";
import type {
  FunctionalConflict,
  MergeTarget,
  ModResolution,
  OverrideConflict,
  OverrideDecision,
  ParsedPack,
  RamEstimate,
} from "@/lib/core/types";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, applyTheme, type Settings } from "@/lib/settings";
import { setProviderConfig } from "@/lib/core/providers/config";
import { detectRelay, type RelayStatus } from "@/lib/relay";
import { dropAllArchives } from "@/lib/archives";

const STATE_KEY = "modpack-merger.state.v1";

export interface MergeState {
  packs: ParsedPack[];
  target: MergeTarget | null;
  resolutions: ModResolution[];
  conflicts: FunctionalConflict[];
  overrideConflicts: OverrideConflict[];
  overrideStats: { uniqueCount: number; identicalCount: number };
  decisions: Record<string, OverrideDecision>;
  ram: RamEstimate | null;
  analyzed: boolean;
}

const EMPTY: MergeState = {
  packs: [],
  target: null,
  resolutions: [],
  conflicts: [],
  overrideConflicts: [],
  overrideStats: { uniqueCount: 0, identicalCount: 0 },
  decisions: {},
  ram: null,
  analyzed: false,
};

interface Ctx {
  state: MergeState;
  setState: React.Dispatch<React.SetStateAction<MergeState>>;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  reset: () => Promise<void>;
  /** true tant que l'etat sauvegarde n'a pas ete relu */
  hydrated: boolean;
  /** relais fourni par l'hebergement, null tant que la detection tourne */
  relay: RelayStatus | null;
}

const MergeContext = React.createContext<Ctx | null>(null);

export function MergeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<MergeState>(EMPTY);
  const [settings, setSettings] = React.useState<Settings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = React.useState(false);
  const [relay, setRelay] = React.useState<RelayStatus | null>(null);

  // Relecture au demarrage : reglages depuis localStorage, avancement depuis
  // IndexedDB (l'etat contient des listes de mods, trop gros pour localStorage).
  React.useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    applyTheme(s.theme);
    setProviderConfig({
      curseforgeProxyUrl: s.curseforgeProxyUrl,
      curseforgeApiKey: s.curseforgeApiKey,
      downloadConcurrency: s.downloadConcurrency,
    });

    // L'hebergement fournit peut-etre un relais CurseForge : on le demande
    // une fois au demarrage plutot que de le deviner.
    detectRelay().then(setRelay).catch(() => setRelay({ kind: "none" }));

    idbGet<MergeState>(STATE_KEY)
      .then((saved) => {
        if (saved?.packs?.length) setState({ ...EMPTY, ...saved });
      })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  // Suit le theme systeme tant que l'utilisateur n'a pas choisi explicitement
  React.useEffect(() => {
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [settings.theme]);

  // Sauvegarde differee : on ecrit apres la rafale de mises a jour, pas pendant
  React.useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      idbSet(STATE_KEY, state).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [state, hydrated]);

  const updateSettings = React.useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      setProviderConfig({
        curseforgeProxyUrl: next.curseforgeProxyUrl,
        curseforgeApiKey: next.curseforgeApiKey,
        downloadConcurrency: next.downloadConcurrency,
      });
      return next;
    });
  }, []);

  const reset = React.useCallback(async () => {
    setState(EMPTY);
    await Promise.all([idbDel(STATE_KEY).catch(() => {}), dropAllArchives().catch(() => {})]);
  }, []);

  const value = React.useMemo(
    () => ({ state, setState, settings, updateSettings, reset, hydrated, relay }),
    [state, settings, updateSettings, reset, hydrated, relay],
  );

  return <MergeContext.Provider value={value}>{children}</MergeContext.Provider>;
}

export function useMerge(): Ctx {
  const ctx = React.useContext(MergeContext);
  if (!ctx) throw new Error("useMerge doit etre utilise dans MergeProvider");
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Etapes de l'assistant                                               */
/* ------------------------------------------------------------------ */

export const STEPS = [
  { href: "/", label: "Modpacks", short: "Packs" },
  { href: "/cible/", label: "Configuration cible", short: "Cible" },
  { href: "/mods/", label: "Mods", short: "Mods" },
  { href: "/fichiers/", label: "Fichiers de config", short: "Fichiers" },
  { href: "/export/", label: "Export", short: "Export" },
] as const;

/** Derniere etape atteignable compte tenu de l'avancement. */
export function furthestStep(state: MergeState): number {
  if (!state.packs.length) return 0;
  if (!state.analyzed) return 1;
  return 4;
}
