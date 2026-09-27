"use client";

import * as React from "react";
import { CircleHelp, Search, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CONTENT_INFO } from "@/lib/core/content";
import { sideOf } from "@/lib/core/summary";
import { includedIn, sideIsKnown, type PackTarget, type Side } from "@/lib/core/sides";
import { cn } from "@/lib/utils";
import type { ModResolution } from "@/lib/core/types";

const SIDE_LABEL: Record<Side, string> = {
  client: "Client",
  both: "Les deux",
  server: "Serveur",
};

type Filter = "all" | "check" | Side;

const PAGE = 50;

/**
 * Cote de chaque element retenu, modifiable.
 *
 * Les plateformes ne declarent pas toujours ou un mod doit tourner : ceux
 * dont on ne sait rien partent des deux cotes et sont signales en tete, pour
 * que l'utilisateur tranche plutot que de decouvrir l'erreur au demarrage
 * du serveur.
 */
export function ModSideList({
  resolutions,
  overrides,
  target,
  onChange,
}: {
  resolutions: ModResolution[];
  overrides: Record<string, Side>;
  target: PackTarget;
  onChange: (next: Record<string, Side>) => void;
}) {
  const [filter, setFilter] = React.useState<Filter>("all");
  const [query, setQuery] = React.useState("");
  const [limit, setLimit] = React.useState(PAGE);

  const kept = resolutions.filter(
    (r) => (r.status === "ok" || r.status === "substituted") && r.picked,
  );
  const sideOfR = (r: ModResolution) => overrides[r.key] ?? sideOf(r);
  const needsCheck = (r: ModResolution) => !overrides[r.key] && !sideIsKnown(r);
  const toCheck = kept.filter(needsCheck);

  const counts: Record<Filter, number> = {
    all: kept.length,
    check: toCheck.length,
    client: kept.filter((r) => sideOfR(r) === "client").length,
    both: kept.filter((r) => sideOfR(r) === "both").length,
    server: kept.filter((r) => sideOfR(r) === "server").length,
  };

  const q = query.trim().toLowerCase();
  const shown = kept
    .filter((r) =>
      filter === "all" ? true : filter === "check" ? needsCheck(r) : sideOfR(r) === filter,
    )
    .filter((r) => !q || r.name.toLowerCase().includes(q))
    // Ce qui demande une verification d'abord, puis par ordre alphabetique.
    .sort((a, b) => Number(needsCheck(b)) - Number(needsCheck(a)) || a.name.localeCompare(b.name, "fr"));

  const set = (key: string, side: Side) => onChange({ ...overrides, [key]: side });
  const reset = (key: string) => {
    const next = { ...overrides };
    delete next[key];
    onChange(next);
  };
  const confirmAll = () => {
    const next = { ...overrides };
    for (const r of toCheck) next[r.key] = "both";
    onChange(next);
  };

  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: "Tous" },
    { id: "check", label: "À vérifier" },
    { id: "client", label: "Client" },
    { id: "both", label: "Les deux" },
    { id: "server", label: "Serveur" },
  ];

  return (
    <div className="space-y-3">
      {toCheck.length > 0 && (
        <div className="border-warning/60 bg-warning/5 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
          <p className="max-w-2xl text-pretty">
            <CircleHelp className="text-warning-foreground dark:text-warning mr-1.5 inline size-4 align-text-bottom" aria-hidden />
            <strong>{toCheck.length}</strong> élément{toCheck.length > 1 ? "s" : ""} sans côté déclaré
            par leur source : ils partent des deux côtés par prudence. Un mod d&apos;affichage
            laissé sur un serveur peut l&apos;empêcher de démarrer.
          </p>
          <Button size="sm" variant="outline" onClick={confirmAll}>
            Tout garder des deux côtés
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filtrer par côté" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Button
              key={f.id}
              size="sm"
              variant={filter === f.id ? "secondary" : "ghost"}
              aria-pressed={filter === f.id}
              onClick={() => {
                setFilter(f.id);
                setLimit(PAGE);
              }}
            >
              {f.label} <span className="text-muted-foreground tabular-nums">{counts[f.id]}</span>
            </Button>
          ))}
        </div>
        <div className="relative ml-auto min-w-52 flex-1 sm:max-w-xs">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden />
          <Input
            type="search"
            aria-label="Filtrer par nom"
            placeholder="Filtrer par nom…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            className="pl-9"
          />
        </div>
      </div>

      <ul className="divide-y rounded-lg border">
        {shown.slice(0, limit).map((r) => {
          const side = sideOfR(r);
          const check = needsCheck(r);
          const excluded =
            target === "both" ? null : includedIn(side, target) ? null : target;
          return (
            <li
              key={r.key}
              className={cn(
                "flex flex-wrap items-center justify-between gap-3 px-3 py-2.5",
                excluded && "opacity-60",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                  {r.name}
                  {r.kind !== "mod" && <Badge variant="outline">{CONTENT_INFO[r.kind].label}</Badge>}
                  {check && (
                    <Badge variant="warning">
                      <CircleHelp aria-hidden /> à vérifier
                    </Badge>
                  )}
                  {overrides[r.key] && (
                    <Badge variant="info">
                      <UserCheck aria-hidden /> choisi par toi
                    </Badge>
                  )}
                  {excluded && (
                    <Badge variant="outline">absent du pack {excluded === "client" ? "client" : "serveur"}</Badge>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  {r.picked?.versionNumber}
                  {overrides[r.key] && (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className="hover:text-foreground underline underline-offset-2"
                        onClick={() => reset(r.key)}
                      >
                        revenir au côté détecté ({SIDE_LABEL[sideOf(r)]})
                      </button>
                    </>
                  )}
                </p>
              </div>

              <fieldset className="flex shrink-0 rounded-md border p-0.5">
                <legend className="sr-only">Côté de {r.name}</legend>
                {(["client", "both", "server"] as Side[]).map((s) => (
                  <label
                    key={s}
                    className={cn(
                      "cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors",
                      "has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-2",
                      side === s ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                    )}
                  >
                    <input
                      type="radio"
                      name={`side-${r.key}`}
                      value={s}
                      checked={side === s}
                      onChange={() => set(r.key, s)}
                      className="sr-only"
                    />
                    {SIDE_LABEL[s]}
                  </label>
                ))}
              </fieldset>
            </li>
          );
        })}
        {!shown.length && (
          <li className="text-muted-foreground px-3 py-6 text-center text-sm">
            Aucun élément ne correspond.
          </li>
        )}
      </ul>

      {shown.length > limit && (
        <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
          Afficher {Math.min(PAGE, shown.length - limit)} de plus ({shown.length - limit} restants)
        </Button>
      )}
    </div>
  );
}
