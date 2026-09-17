"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleCheck, FileCog, Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StepGuard } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMerge } from "@/lib/store";
import { humanSize } from "@/lib/format";
import type { OverrideDecision } from "@/lib/core/types";

const KIND_LABEL: Record<string, string> = {
  json: "JSON",
  keyvalue: "cle=valeur",
  text: "texte",
  binary: "binaire",
};

export default function FilesPage() {
  const router = useRouter();
  const { state, setState, hydrated } = useMerge();
  const [filter, setFilter] = React.useState("");

  if (!hydrated) return null;
  if (!state.analyzed) {
    return (
      <StepGuard
        title="Fusion pas encore calculee"
        description="Les conflits de configuration sont detectes pendant la fusion."
        href="/cible/"
        cta="Configurer la cible"
      />
    );
  }

  const conflicts = state.overrideConflicts;
  const { uniqueCount, identicalCount } = state.overrideStats;

  const q = filter.trim().toLowerCase();
  const shown = q ? conflicts.filter((c) => c.path.toLowerCase().includes(q)) : conflicts;

  function setDecision(path: string, decision: OverrideDecision) {
    setState((prev) => ({ ...prev, decisions: { ...prev.decisions, [path]: decision } }));
  }

  function setAll(decision: OverrideDecision) {
    setState((prev) => {
      const next = { ...prev.decisions };
      for (const c of conflicts) {
        next[c.path] =
          decision === "merge" && !c.mergeable ? c.sides[0].packId : decision;
      }
      return { ...prev, decisions: next };
    });
  }

  const mergeableCount = conflicts.filter((c) => c.mergeable).length;
  const priority = state.packs[0];

  return (
    <>
      <PageHeader
        title="Fichiers de configuration"
        description="Configs, scripts KubeJS, resource packs… Seuls les fichiers fournis par plusieurs packs avec un contenu different demandent un arbitrage."
        action={
          <Button onClick={() => router.push("/export/")}>
            Continuer <ArrowRight />
          </Button>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat value={uniqueCount} label="copies tels quels" hint="fournis par un seul pack" />
        <Stat value={identicalCount} label="identiques" hint="meme contenu partout" />
        <Stat
          value={conflicts.length}
          label="a arbitrer"
          hint="contenus differents"
          tone={conflicts.length ? "warning" : "success"}
        />
      </div>

      {conflicts.length === 0 ? (
        <Alert variant="success" className="mb-6">
          <CircleCheck />
          <AlertTitle>Aucun conflit de configuration</AlertTitle>
          <AlertDescription>
            Tes packs ne se marchent pas dessus : tous leurs fichiers seront copies sans
            intervention.
          </AlertDescription>
        </Alert>
      ) : (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCog className="text-warning size-4" />
              {conflicts.length} fichier{conflicts.length > 1 ? "s" : ""} en conflit
            </CardTitle>
            <CardDescription>
              Par defaut, les formats fusionnables le sont, et les autres reviennent au pack{" "}
              <strong>{priority?.label}</strong> ({priority?.name}), le plus haut dans ta liste.
              Tu peux changer cet ordre a l&apos;etape 1.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setAll("merge")}>
                Tout fusionner ({mergeableCount} possibles)
              </Button>
              {state.packs.map((p) => (
                <Button
                  key={p.id}
                  variant="outline"
                  size="sm"
                  onClick={() => setAll(p.id)}
                >
                  Tout prendre du pack {p.label}
                </Button>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setAll("all")}>
                Tout garder en double
              </Button>
            </div>

            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                type="search"
                placeholder="Filtrer par chemin…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="max-h-[32rem] divide-y overflow-y-auto rounded-lg border">
              {shown.map((c) => {
                const decision = state.decisions[c.path] ?? c.suggestion;
                return (
                  <div
                    key={c.path}
                    className="flex flex-wrap items-center justify-between gap-3 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-xs break-all">{c.path}</div>
                      <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <Badge variant="outline">{KIND_LABEL[c.kind] ?? c.kind}</Badge>
                        {c.sides.map((s) => (
                          <span key={s.packId}>
                            {s.label} {humanSize(s.size)}
                          </span>
                        ))}
                        {c.note && <span>· {c.note}</span>}
                      </div>
                    </div>

                    <ToggleGroup
                      type="single"
                      value={decision}
                      onValueChange={(v) => v && setDecision(c.path, v)}
                    >
                      {c.sides.map((s) => (
                        <Tooltip key={s.packId}>
                          <TooltipTrigger asChild>
                            <ToggleGroupItem value={s.packId}>{s.label}</ToggleGroupItem>
                          </TooltipTrigger>
                          <TooltipContent>Garder la version du pack {s.label}</TooltipContent>
                        </Tooltip>
                      ))}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <ToggleGroupItem value="merge" disabled={!c.mergeable}>
                            fusion
                          </ToggleGroupItem>
                        </TooltipTrigger>
                        <TooltipContent>
                          {c.mergeable
                            ? "Fusionner cle par cle, le pack prioritaire tranche les valeurs divergentes"
                            : "Format non fusionnable automatiquement"}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <ToggleGroupItem value="all">tous</ToggleGroupItem>
                        </TooltipTrigger>
                        <TooltipContent>
                          Garder toutes les versions, les non prioritaires sont renommees
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <ToggleGroupItem value="skip">✕</ToggleGroupItem>
                        </TooltipTrigger>
                        <TooltipContent>N&apos;inclure aucune version</TooltipContent>
                      </Tooltip>
                    </ToggleGroup>
                  </div>
                );
              })}

              {!shown.length && (
                <p className="text-muted-foreground py-6 text-center text-sm">
                  Aucun fichier ne correspond a ce filtre.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={() => router.push("/export/")}>
          Continuer vers l&apos;export <ArrowRight />
        </Button>
        <Button variant="outline" onClick={() => router.push("/mods/")}>
          Retour aux mods
        </Button>
      </div>
    </>
  );
}

function Stat({
  value,
  label,
  hint,
  tone,
}: {
  value: number;
  label: string;
  hint: string;
  tone?: "warning" | "success";
}) {
  const color =
    tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "";
  return (
    <div className="rounded-lg border p-3">
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      <div className="mt-0.5 text-sm font-medium">{label}</div>
      <div className="text-muted-foreground text-xs">{hint}</div>
    </div>
  );
}
