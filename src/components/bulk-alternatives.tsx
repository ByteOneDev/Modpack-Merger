"use client";

import * as React from "react";
import {
  Check, CircleX, ExternalLink, Loader2, Sparkles, SquareCheck, TriangleAlert, Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  findAlternativesForAll, estimateRemaining,
  type BulkProgress, type BulkSuggestion,
} from "@/lib/bulk-alternatives";
import { humanDownloads, plural } from "@/lib/format";
import type { Alternative, MergeTarget, ModResolution } from "@/lib/core/types";

type Phase = "idle" | "running" | "review";

export function BulkAlternatives({
  missing,
  target,
  onApply,
}: {
  missing: ModResolution[];
  target: MergeTarget;
  /** applique les choix retenus ; recoit la cle du mod et l'alternative */
  onApply: (
    picks: { key: string; alt: Alternative }[],
    onProgress: (done: number, total: number) => void,
  ) => Promise<void>;
}) {
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [progress, setProgress] = React.useState<BulkProgress | null>(null);
  const [startedAt, setStartedAt] = React.useState(0);
  const [suggestions, setSuggestions] = React.useState<BulkSuggestion[]>([]);
  const [chosen, setChosen] = React.useState<Record<string, string>>({});
  const [applying, setApplying] = React.useState<{ done: number; total: number } | null>(null);
  const handleRef = React.useRef<{ cancel: () => void } | null>(null);

  async function start() {
    setPhase("running");
    setStartedAt(Date.now());
    setProgress({ done: 0, total: missing.length, current: "", found: 0 });

    const handle = findAlternativesForAll(missing, target, setProgress);
    handleRef.current = handle;

    const results = await handle.results;
    setSuggestions(results);
    setChosen(
      Object.fromEntries(
        results
          .filter((s) => s.best)
          .map((s) => [s.key, s.best!.project.projectId]),
      ),
    );
    setPhase("review");
  }

  const selectedCount = suggestions.filter((s) => s.selected && s.best).length;

  function optionsFor(s: BulkSuggestion): Alternative[] {
    return s.best ? [s.best, ...s.others] : [];
  }

  function currentAlt(s: BulkSuggestion): Alternative | null {
    const id = chosen[s.key];
    return optionsFor(s).find((a) => a.project.projectId === id) ?? s.best;
  }

  async function apply() {
    const picks = suggestions
      .filter((s) => s.selected)
      .map((s) => ({ key: s.key, alt: currentAlt(s)! }))
      .filter((p) => p.alt);

    setApplying({ done: 0, total: picks.length });
    await onApply(picks, (done, total) => setApplying({ done, total }));
    setApplying(null);
    setPhase("idle");
    setSuggestions([]);
  }

  /* ---------------- inactif ---------------- */

  if (phase === "idle") {
    return (
      <Button onClick={() => void start()}>
        <Wand2 />
        Chercher une alternative pour {missing.length > 1 ? "les " : "le "}
        {plural(missing.length, "mod")}
      </Button>
    );
  }

  /* ---------------- recherche en cours ---------------- */

  if (phase === "running" && progress) {
    const pct = Math.round((progress.done / Math.max(progress.total, 1)) * 100);
    return (
      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="size-4 animate-spin" />
            {progress.done} / {progress.total} mods analyses
            <span className="text-success font-normal">
              · {plural(progress.found, "alternative")} trouvee{progress.found > 1 ? "s" : ""}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleRef.current?.cancel()}
          >
            <CircleX /> Arreter
          </Button>
        </div>

        <Progress value={pct} />

        <p className="text-muted-foreground truncate text-xs">
          {progress.current && `En cours : ${progress.current} · `}
          {estimateRemaining(progress, startedAt)}
        </p>

        <p className="text-muted-foreground text-xs text-pretty">
          Chaque mod demande plusieurs requetes aux deux plateformes, et chaque
          proposition est verifiee comme reellement installable. Tu peux arreter a
          tout moment : ce qui a deja ete trouve est conserve.
        </p>
      </div>
    );
  }

  /* ---------------- revue des propositions ---------------- */

  const withAlt = suggestions.filter((s) => s.best);
  const without = suggestions.filter((s) => !s.best);

  return (
    <div className="space-y-4">
      {applying && (
        <Alert variant="info">
          <Loader2 className="animate-spin" />
          <AlertDescription>
            Application des remplacements et de leurs dependances — {applying.done} /{" "}
            {applying.total}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success">{withAlt.length} avec alternative</Badge>
        {without.length > 0 && <Badge variant="secondary">{without.length} sans</Badge>}
        <Badge variant="outline">
          {plural(selectedCount, "selectionnee")}
        </Badge>

        <span className="flex-1" />

        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setSuggestions((prev) => prev.map((s) => ({ ...s, selected: !!s.best })))
          }
        >
          <SquareCheck /> Tout cocher
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSuggestions((prev) => prev.map((s) => ({ ...s, selected: false })))}
        >
          Tout decocher
        </Button>
        <Button disabled={!selectedCount || !!applying} onClick={() => void apply()}>
          <Check /> Appliquer {selectedCount > 1 ? "les " : "le "}
          {plural(selectedCount, "choix", "choix")}
        </Button>
      </div>

      <Alert variant="info">
        <Sparkles />
        <AlertTitle>Ce qui est coche par defaut</AlertTitle>
        <AlertDescription>
          Seules les propositions qui sont un projet original en version stable sont
          preselectionnees. Les forks et les versions beta sont proposes mais laisses
          decoches : ce sont des choix a faire en conscience.
        </AlertDescription>
      </Alert>

      <div className="max-h-[36rem] divide-y overflow-y-auto rounded-lg border">
        {withAlt.map((s) => {
          const alt = currentAlt(s);
          if (!alt) return null;
          const options = optionsFor(s);
          return (
            <div key={s.key} className="flex items-start gap-3 p-3">
              <Switch
                checked={s.selected}
                onCheckedChange={(v) =>
                  setSuggestions((prev) =>
                    prev.map((x) => (x.key === s.key ? { ...x, selected: v } : x)),
                  )
                }
                className="mt-1 shrink-0"
                aria-label={`Remplacer ${s.modName}`}
              />

              <div className="min-w-0 flex-1">
                <div className="text-muted-foreground text-xs">
                  {s.modName} <span aria-hidden>→</span>
                </div>

                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium">{alt.project.title}</span>
                  {alt.curated && <Badge variant="success">equivalent connu</Badge>}
                  {alt.isFork ? (
                    <Badge variant="warning">fork</Badge>
                  ) : (
                    <Badge variant="secondary">original</Badge>
                  )}
                  {alt.version.versionType !== "release" && (
                    <Badge variant="warning">{alt.version.versionType}</Badge>
                  )}
                  <Badge variant="outline">{alt.project.provider}</Badge>
                  <a
                    href={alt.project.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Voir la page du mod"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                </div>

                <p className="text-muted-foreground mt-1 font-mono text-[11px]">
                  {alt.version.versionNumber} · {humanDownloads(alt.project.downloads)} dl ·{" "}
                  {alt.rationale}
                </p>
              </div>

              {options.length > 1 && (
                <Select
                  value={chosen[s.key] ?? alt.project.projectId}
                  onValueChange={(v) => setChosen((prev) => ({ ...prev, [s.key]: v }))}
                >
                  <SelectTrigger className="w-40 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((o) => (
                      <SelectItem key={o.project.projectId} value={o.project.projectId}>
                        {o.project.title}
                        {o.isFork ? " (fork)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          );
        })}
      </div>

      {without.length > 0 && (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>
            {plural(without.length, "mod")} sans equivalent installable
          </AlertTitle>
          <AlertDescription>
            <p className="mb-1">
              Aucun mod couvrant la meme fonction ne publie de version pour {target.loader}{" "}
              {target.minecraft}. Ils resteront introuvables.
            </p>
            <p className="font-mono text-[11px] break-words">
              {without.slice(0, 40).map((s) => s.modName).join(" · ")}
              {without.length > 40 && ` · et ${without.length - 40} autres`}
            </p>
          </AlertDescription>
        </Alert>
      )}

      <Button variant="ghost" size="sm" onClick={() => setPhase("idle")}>
        Fermer sans appliquer
      </Button>
    </div>
  );
}
