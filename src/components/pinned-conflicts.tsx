"use client";

import * as React from "react";
import { ArrowDown, Loader2, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { describePinned, type PinnedConflict } from "@/lib/core/merge/pinned";
import type { ModResolution } from "@/lib/core/types";

/**
 * Versions epinglees non respectees.
 *
 * Le cas typique : Iris exige une version precise de Sodium parce qu'il
 * reecrit ses classes internes. Prendre la derniere version de chacun donne
 * un pack qui s'installe sans broncher et plante au chargement du monde, sur
 * une erreur qui ne nomme ni l'un ni l'autre.
 */
export function PinnedConflicts({
  conflicts,
  resolutions,
  onAlign,
  onDropDependent,
}: {
  conflicts: PinnedConflict[];
  resolutions: ModResolution[];
  onAlign: (c: PinnedConflict) => Promise<{ error?: string }>;
  onDropDependent: (key: string) => void;
}) {
  const [detailed, setDetailed] = React.useState<PinnedConflict[]>(conflicts);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Le numero de version exige n'est qu'un identifiant : on le resout pour
  // pouvoir l'afficher, sans bloquer le rendu.
  React.useEffect(() => {
    setDetailed(conflicts);
    if (!conflicts.length) return;
    let vivant = true;
    describePinned(conflicts, resolutions)
      .then((d) => vivant && setDetailed(d))
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, [conflicts, resolutions]);

  if (!conflicts.length) return null;

  return (
    <Card className="border-destructive/40 mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TriangleAlert className="text-destructive size-4" />
          Versions incompatibles
          <Badge variant="destructive">{conflicts.length}</Badge>
        </CardTitle>
        <CardDescription>
          Ces mods n&apos;exigent pas seulement la présence d&apos;un autre mod, mais une{" "}
          <strong>version précise</strong> — ils en réécrivent les classes internes. Avec une autre
          version, le pack s&apos;installe normalement puis plante au chargement du monde.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {detailed.map((c) => (
          <div key={`${c.dependentKey}-${c.dependencyKey}`} className="rounded-lg border p-3">
            <p className="text-sm">
              <strong>{c.dependentName}</strong>{" "}
              <span className="text-muted-foreground font-mono text-xs">
                {c.dependentVersion}
              </span>{" "}
              exige <strong>{c.dependencyName}</strong> en{" "}
              <span className="font-mono text-xs">{c.requiredVersion ?? "une autre version"}</span>.
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Le pack contient <span className="font-mono">{c.installedVersion}</span>, plus
              récente mais incompatible.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(c.dependencyKey);
                  setError(null);
                  try {
                    const r = await onAlign(c);
                    if (r.error) setError(r.error);
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === c.dependencyKey ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <ArrowDown />
                )}
                Rétrograder {c.dependencyName} en {c.requiredVersion ?? "version exigée"}
              </Button>

              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => onDropDependent(c.dependentKey)}
              >
                <Trash2 /> Retirer {c.dependentName} et garder la version récente
              </Button>
            </div>
          </div>
        ))}

        <Alert variant="info">
          <TriangleAlert />
          <AlertTitle>Pourquoi ce n&apos;est pas détecté plus tôt</AlertTitle>
          <AlertDescription>
            « La version la plus récente de chaque mod » et « un ensemble qui démarre » ne sont pas
            la même chose. Seul Modrinth publie ces contraintes de version ; CurseForge ne déclare
            que des dépendances de projet, sans version — un conflit venant uniquement de
            CurseForge reste donc invisible ici.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
