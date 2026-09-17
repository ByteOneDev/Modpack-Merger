"use client";

import * as React from "react";
import { ExternalLink, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { findAlternatives } from "@/lib/core/merge/alternatives";
import { humanDownloads } from "@/lib/format";
import type { Alternative, MergeTarget, ModResolution } from "@/lib/core/types";

export function AlternativesList({
  resolution,
  target,
  onPick,
  onGiveUp,
}: {
  resolution: ModResolution;
  target: MergeTarget;
  onPick: (alt: Alternative) => Promise<void> | void;
  onGiveUp: () => void;
}) {
  const [data, setData] = React.useState<{
    alternatives: Alternative[];
    note: string | null;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [applying, setApplying] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);

    findAlternatives(resolution, target)
      .then((r) => !cancelled && setData(r))
      .catch(() => !cancelled && setError("La recherche a echoue."));

    return () => {
      cancelled = true;
    };
  }, [resolution, target]);

  const onlyForks = !!data && data.alternatives.length > 0 && data.alternatives.every((a) => a.isFork);

  if (error) {
    return (
      <Alert variant="destructive" className="mt-3">
        <TriangleAlert />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!data) {
    return (
      <p className="text-muted-foreground mt-3 flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Recherche sur Modrinth et CurseForge, puis verification qu&apos;une version installable
        existe vraiment…
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      {data.note && (
        <Alert variant={onlyForks ? "warning" : "info"}>
          {onlyForks ? <TriangleAlert /> : <ShieldCheck />}
          <AlertDescription>{data.note}</AlertDescription>
        </Alert>
      )}

      {data.alternatives.length === 0 ? (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertDescription>
            Aucun mod equivalent ne publie de version compatible avec {target.loader}{" "}
            {target.minecraft}. Ce mod devra etre abandonne, ou cherche a la main.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-2">
          {data.alternatives.map((alt) => (
            <div
              key={`${alt.project.provider}-${alt.project.projectId}`}
              className={`rounded-lg border p-3 ${alt.isFork ? "border-warning/40" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{alt.project.title}</span>
                {alt.curated && <Badge variant="success">equivalent connu</Badge>}
                {alt.isFork ? (
                  <Badge variant="warning">fork</Badge>
                ) : (
                  <Badge variant="secondary">projet original</Badge>
                )}
                <Badge variant="outline">{alt.project.provider}</Badge>
                {alt.version.versionType !== "release" && (
                  <Badge variant="warning">{alt.version.versionType}</Badge>
                )}
                <span className="text-muted-foreground ml-auto font-mono text-[11px]">
                  score {alt.score}
                </span>
              </div>

              <p className="text-muted-foreground mt-1.5 text-sm text-pretty">
                {alt.project.description}
              </p>

              <p className="text-muted-foreground mt-1.5 font-mono text-[11px]">
                {alt.version.versionNumber} · {humanDownloads(alt.project.downloads)} dl ·{" "}
                {alt.rationale}
              </p>

              <div className="mt-3 flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={applying !== null}
                  onClick={async () => {
                    setApplying(alt.project.projectId);
                    try {
                      await onPick(alt);
                    } finally {
                      setApplying(null);
                    }
                  }}
                >
                  {applying === alt.project.projectId && <Loader2 className="animate-spin" />}
                  Utiliser celui-ci
                </Button>
                <Button variant="ghost" size="sm" asChild>
                  <a href={alt.project.url} target="_blank" rel="noreferrer noopener">
                    Voir la page <ExternalLink />
                  </a>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Button variant="outline" size="sm" onClick={onGiveUp}>
        Se passer de ce mod
      </Button>
    </div>
  );
}
