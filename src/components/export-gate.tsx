"use client";

import * as React from "react";
import { CircleCheck, CircleX, Lock, Search, TriangleAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Blocker, Readiness } from "@/lib/readiness";

const TITRE: Record<Blocker["kind"], string> = {
  missing: "Sans version compatible",
  manual: "À récupérer à la main",
  failed: "Téléchargement échoué",
};

const AIDE: Record<Blocker["kind"], string> = {
  missing:
    "Ces éléments n'existent pas pour la cible choisie. Cherche une alternative à l'étape Mods, " +
    "ou écarte-les si tu peux t'en passer.",
  manual:
    "Leur auteur interdit la distribution par des tiers. Ouvre leur page ci-dessus, récupère le " +
    "fichier, puis rends-le à l'outil.",
  failed:
    "Le CDN a refusé la requête lors d'une génération précédente. Réessaie, ou récupère le " +
    "fichier à la main.",
};

/**
 * Verrou de l'etape finale.
 *
 * Tant qu'il manque quelque chose, la generation est refusee : une archive
 * incomplete s'installe sans rien dire et ne se trahit qu'au lancement du
 * jeu, parfois bien plus tard. La seule facon de passer outre est d'ecarter
 * explicitement ce qui manque, ce qui est une decision, pas un contournement.
 */
export function ExportGate({
  readiness,
  onExclude,
  onGoToMods,
}: {
  readiness: Readiness;
  onExclude: (keys: string[]) => void;
  onGoToMods: () => void;
}) {
  const groupes = (
    [
      { kind: "missing", items: readiness.missing },
      { kind: "manual", items: readiness.manual },
      { kind: "failed", items: readiness.failed },
    ] as { kind: Blocker["kind"]; items: Blocker[] }[]
  ).filter((g) => g.items.length > 0);

  if (readiness.ready) {
    return (
      <Alert variant="success" className="mb-6">
        <CircleCheck />
        <AlertTitle>Le pack est complet</AlertTitle>
        <AlertDescription>
          Tous les mods, resource packs, shaders et datapacks retenus ont une source utilisable.
          {readiness.warnings.length > 0 && " Quelques points restent à surveiller, ci-dessous."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="border-destructive/40 mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="text-destructive size-4" />
          Génération bloquée
          <Badge variant="destructive">{readiness.blockers.length}</Badge>
        </CardTitle>
        <CardDescription>
          Il manque de quoi construire le pack en entier. Une archive incomplète s&apos;installe
          sans broncher et ne se trahit qu&apos;au démarrage du jeu — l&apos;outil préfère ne rien
          produire.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {groupes.map((g) => (
          <section key={g.kind}>
            <h3 className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <CircleX className="text-destructive size-4" />
              {TITRE[g.kind]}
              <Badge variant="outline">{g.items.length}</Badge>
            </h3>
            <p className="text-muted-foreground mt-0.5 mb-2 text-xs text-pretty">{AIDE[g.kind]}</p>

            <div className="max-h-56 divide-y overflow-y-auto rounded-lg border">
              {g.items.map((b) => (
                <div key={b.key} className="flex items-start gap-3 p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{b.name}</div>
                    <p className="text-muted-foreground mt-0.5 text-xs text-pretty">{b.detail}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Écarter ${b.name}`}
                    title="Écarter cet élément du pack"
                    onClick={() => onExclude([b.key])}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>

            {g.kind === "missing" && (
              <Button variant="outline" size="sm" className="mt-2" onClick={onGoToMods}>
                <Search /> Chercher des alternatives
              </Button>
            )}
          </section>
        ))}

        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>Se passer de ces éléments</AlertTitle>
          <AlertDescription>
            <p>
              Les écarter débloque la génération. Ils ne seront pas dans le pack, et le{" "}
              <code className="font-mono text-xs">RAPPORT-DE-FUSION.md</code> en gardera la trace —
              c&apos;est un choix assumé, pas un contournement.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => onExclude(readiness.blockers.map((b) => b.key))}
            >
              <Trash2 />
              {readiness.blockers.length === 1
                ? "Écarter cet élément et continuer"
                : `Écarter ces ${readiness.blockers.length} éléments et continuer`}
            </Button>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
