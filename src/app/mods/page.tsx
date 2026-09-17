"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight, CircleAlert, CircleCheck, Layers,
  RotateCcw, Search, Trash2, TriangleAlert, Wrench,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StepGuard } from "@/components/empty-state";
import { RamCard } from "@/components/ram-card";
import { AlternativesList } from "@/components/alternatives";
import { BulkAlternatives } from "@/components/bulk-alternatives";
import { AddMod } from "@/components/add-mod";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMerge } from "@/lib/store";
import {
  addMod, applyAlternative, applyAlternatives, excludeMod, resolveConflict, restoreMod,
} from "@/lib/actions";
import type { ModResolution } from "@/lib/core/types";

export default function ModsPage() {
  const router = useRouter();
  const { state, setState, settings, hydrated } = useMerge();
  const [openAlt, setOpenAlt] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState("");

  const kept = state.resolutions.filter((r) => r.status === "ok");
  const substituted = state.resolutions.filter((r) => r.status === "substituted");
  const missing = state.resolutions.filter((r) => r.status === "missing");
  const dropped = state.resolutions.filter(
    (r) => r.status === "excluded" || r.status === "duplicate",
  );
  const deps = state.resolutions.filter((r) => r.from.kind === "dependency");
  const hardConflicts = state.conflicts.filter((c) => c.severity === "hard");

  if (!hydrated) return null;
  if (!state.analyzed || !state.target) {
    return (
      <StepGuard
        title="Fusion pas encore calculee"
        description="Choisis d'abord la configuration cible, puis lance la fusion."
        href="/cible/"
        cta="Configurer la cible"
      />
    );
  }

  const target = state.target;

  return (
    <>
      <PageHeader
        title="Resultat de la fusion"
        description={`${kept.length + substituted.length} mods retenus pour ${target.loader} ${target.minecraft}, a partir de ${state.packs.length} packs.`}
        action={
          <Button onClick={() => router.push("/fichiers/")}>
            Continuer <ArrowRight />
          </Button>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Mods retenus" value={kept.length + substituted.length} tone="success" />
        <Stat label="Introuvables" value={missing.length} tone={missing.length ? "danger" : undefined} />
        <Stat label="Dependances ajoutees" value={deps.length} tone="info" />
        <Stat
          label="Doublons fonctionnels"
          value={state.conflicts.length}
          tone={hardConflicts.length ? "danger" : state.conflicts.length ? "warning" : undefined}
        />
        <Stat label="Ecartes" value={dropped.length} />
      </div>

      {state.ram && (
        <div className="mb-6">
          <RamCard ram={state.ram} />
        </div>
      )}

      {missing.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CircleAlert className="text-destructive size-4" />
              {missing.length} mod{missing.length > 1 ? "s" : ""} sans version compatible
            </CardTitle>
            <CardDescription>
              Ces mods n&apos;existent pas pour {target.loader} {target.minecraft}. Seules les
              alternatives ayant reellement une version installable sont proposees, et les forks
              sont signales comme tels.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <BulkAlternatives
              missing={missing}
              target={target}
              onApply={async (picks, onProgress) => {
                const patch = await applyAlternatives(state, picks, settings, onProgress);
                setState((prev) => ({ ...prev, ...patch }));
              }}
            />

            <Separator />

            {/* Repli mod par mod, pour ceux qu'on veut traiter a la main */}
            <details className="group">
              <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none text-sm">
                Traiter les mods un par un
              </summary>

              <div className="mt-3 space-y-2">
                {missing.map((r) => (
                  <div key={r.key} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">{r.name}</div>
                        <div className="text-muted-foreground text-xs">{r.reason}</div>
                      </div>
                      <Button
                        size="sm"
                        variant={openAlt === r.key ? "secondary" : "outline"}
                        onClick={() => setOpenAlt(openAlt === r.key ? null : r.key)}
                      >
                        <Search />
                        {openAlt === r.key ? "Masquer" : "Chercher"}
                      </Button>
                    </div>

                    {openAlt === r.key && (
                      <AlternativesList
                        resolution={r}
                        target={target}
                        onPick={async (alt) => {
                          const patch = await applyAlternative(state, r.key, alt, settings);
                          setState((prev) => ({ ...prev, ...patch }));
                          setOpenAlt(null);
                        }}
                        onGiveUp={() => {
                          setState((prev) => ({ ...prev, ...excludeMod(state, r.key, settings) }));
                          setOpenAlt(null);
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
            </details>
          </CardContent>
        </Card>
      )}

      {state.conflicts.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="text-warning size-4" />
              Doublons fonctionnels
            </CardTitle>
            <CardDescription>
              Des mods differents qui font la meme chose. Les conflits marques
              <Badge variant="destructive" className="mx-1.5">
                bloquant
              </Badge>
              empechent le jeu de demarrer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {state.conflicts.map((c) => (
              <div key={c.groupId} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.groupLabel}</span>
                  <Badge variant={c.severity === "hard" ? "destructive" : "warning"}>
                    {c.severity === "hard" ? "bloquant" : "redondant"}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-1 text-sm text-pretty">{c.explanation}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {c.members.map((m) => (
                    <Button
                      key={m.key}
                      size="sm"
                      variant={m.recommended ? "default" : "outline"}
                      onClick={() =>
                        setState((prev) => ({
                          ...prev,
                          ...resolveConflict(
                            state,
                            m.key,
                            c.members.map((x) => x.key),
                            settings,
                          ),
                        }))
                      }
                    >
                      Garder {m.name}
                      {m.recommended && " ★"}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="mb-6">
        <AddMod
          target={target}
          onAdd={async (provider, projectId) => {
            const patch = await addMod(state, provider, projectId, settings);
            if (!patch.error) setState((prev) => ({ ...prev, ...patch }));
            return patch;
          }}
        />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Liste complete</CardTitle>
          <CardDescription>
            Retire un mod que tu ne veux pas, ou remets-en un que tu as ecarte.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative mb-4">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              type="search"
              placeholder="Filtrer par nom…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-9"
            />
          </div>

          <Tabs defaultValue="kept">
            <TabsList>
              <TabsTrigger value="kept">Retenus ({kept.length})</TabsTrigger>
              <TabsTrigger value="substituted">Remplaces ({substituted.length})</TabsTrigger>
              <TabsTrigger value="dropped">Ecartes ({dropped.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="kept" className="mt-4">
              <ModList
                rows={kept}
                filter={filter}
                action={(r) => (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Ecarter"
                    onClick={() =>
                      setState((prev) => ({ ...prev, ...excludeMod(state, r.key, settings) }))
                    }
                  >
                    <Trash2 />
                  </Button>
                )}
              />
            </TabsContent>

            <TabsContent value="substituted" className="mt-4">
              <ModList
                rows={substituted}
                filter={filter}
                action={(r) => (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Ecarter"
                    onClick={() =>
                      setState((prev) => ({ ...prev, ...excludeMod(state, r.key, settings) }))
                    }
                  >
                    <Trash2 />
                  </Button>
                )}
              />
            </TabsContent>

            <TabsContent value="dropped" className="mt-4">
              <ModList
                rows={dropped}
                filter={filter}
                action={(r) => (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remettre"
                    onClick={() =>
                      setState((prev) => ({ ...prev, ...restoreMod(state, r.key, settings) }))
                    }
                  >
                    <RotateCcw />
                  </Button>
                )}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {hardConflicts.length > 0 && (
        <Alert variant="warning" className="mb-6">
          <TriangleAlert />
          <AlertTitle>
            {hardConflicts.length} conflit{hardConflicts.length > 1 ? "s" : ""} bloquant
            {hardConflicts.length > 1 ? "s" : ""} non resolu
            {hardConflicts.length > 1 ? "s" : ""}
          </AlertTitle>
          <AlertDescription>
            Le pack se generera quand meme, mais il plantera au demarrage tant que deux mods du
            meme groupe cohabitent.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={() => router.push("/fichiers/")}>
          Continuer vers les fichiers <ArrowRight />
        </Button>
        <Button variant="outline" onClick={() => router.push("/cible/")}>
          <Wrench /> Changer la cible
        </Button>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "danger" | "warning" | "info";
}) {
  const color =
    tone === "success" ? "text-success"
    : tone === "danger" ? "text-destructive"
    : tone === "warning" ? "text-warning"
    : tone === "info" ? "text-info"
    : "";
  return (
    <div className="rounded-lg border p-3">
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      <div className="text-muted-foreground mt-0.5 text-xs">{label}</div>
    </div>
  );
}

function ModList({
  rows,
  filter,
  action,
}: {
  rows: ModResolution[];
  filter: string;
  action: (r: ModResolution) => React.ReactNode;
}) {
  const q = filter.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;

  if (!shown.length) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        {q ? "Aucun mod ne correspond a ce filtre." : "Rien ici."}
      </p>
    );
  }

  return (
    <div className="max-h-[28rem] divide-y overflow-y-auto rounded-lg border">
      {shown.map((r) => (
        <div key={r.key} className="flex items-start gap-3 p-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium">{r.name}</span>
              {r.from.kind === "dependency" && <Badge variant="info">dependance</Badge>}
              {r.from.kind === "manual" && <Badge variant="secondary">ajoute</Badge>}
              {r.mergedFrom && r.mergedFrom.length > 1 && (
                <Badge variant="outline">packs {r.mergedFrom.join("+")}</Badge>
              )}
              {r.unstable && <Badge variant="warning">non stable</Badge>}
              {r.status === "ok" && (
                <CircleCheck className="text-success ml-auto size-3.5 shrink-0" />
              )}
            </div>
            <p className="text-muted-foreground mt-0.5 text-xs text-pretty">{r.reason}</p>
          </div>
          <div className="shrink-0">{action(r)}</div>
        </div>
      ))}
    </div>
  );
}
