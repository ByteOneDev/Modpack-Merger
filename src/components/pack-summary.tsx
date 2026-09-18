"use client";

import * as React from "react";
import {
  Boxes, Image as ImageIcon, Layers, Lock, Monitor, Package, Scroll, Server, Sparkles, Split,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CONTENT_INFO, type ContentKind } from "@/lib/core/content";
import type { PackSummary, SummaryItem } from "@/lib/core/summary";
import { humanSize } from "@/lib/format";

const ICON: Record<ContentKind, React.ReactNode> = {
  mod: <Package className="size-4" />,
  resourcepack: <ImageIcon className="size-4" />,
  shaderpack: <Sparkles className="size-4" />,
  datapack: <Scroll className="size-4" />,
  schematic: <Boxes className="size-4" />,
};

/**
 * Recapitulatif de ce que contient le pack.
 *
 * Deux lectures complementaires : par type de contenu, pour savoir ce qu'on
 * embarque, et par cote, pour savoir ce qu'il faut reellement envoyer sur un
 * serveur dedie — les deux listes n'ont presque rien en commun.
 */
export function PackSummaryView({ summary }: { summary: PackSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="size-4" />
          Récapitulatif du contenu
        </CardTitle>
        <CardDescription>
          {summary.totalItems} éléments · {humanSize(summary.totalBytes)} au total, dont{" "}
          {humanSize(summary.serverBytes)} utiles à un serveur dédié.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {summary.groups.map((g) => (
            <div key={g.kind} className="rounded-lg border p-2.5">
              <div className="flex items-center gap-1.5 text-xl font-semibold">
                {ICON[g.kind]}
                {g.items.length}
              </div>
              <div className="text-muted-foreground mt-0.5 text-xs">{g.label}</div>
              <div className="text-muted-foreground text-[11px]">{humanSize(g.bytes)}</div>
            </div>
          ))}
        </div>

        <Tabs defaultValue="type">
          {/* h-auto + flex-wrap : les trois onglets ne tiennent pas sur une
              largeur de telephone et debordaient la carte. */}
          <TabsList className="h-auto max-w-full flex-wrap justify-start">
            <TabsTrigger value="type">Par type</TabsTrigger>
            <TabsTrigger value="cote">Client / serveur</TabsTrigger>
            <TabsTrigger value="deps">Dépendances ({summary.dependencies.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="type" className="mt-4 space-y-5">
            {summary.groups.map((g) => (
              <section key={g.kind}>
                <h3 className="flex items-center gap-2 text-sm font-medium">
                  {ICON[g.kind]}
                  {g.label}
                  <Badge variant="outline">{g.items.length}</Badge>
                </h3>
                <p className="text-muted-foreground mt-0.5 mb-2 text-xs text-pretty">{g.hint}</p>
                <ItemList items={g.items} />
              </section>
            ))}
          </TabsContent>

          <TabsContent value="cote" className="mt-4 space-y-5">
            <Alert variant="info">
              <Server />
              <AlertTitle>Ce qu&apos;il faut mettre sur un serveur dédié</AlertTitle>
              <AlertDescription>
                Les {summary.serverOnly.length + summary.shared.length} éléments « serveur » et
                « les deux côtés », soit {humanSize(summary.serverBytes)}. Installer un shader ou un
                resource pack sur un serveur ne fait rien d&apos;autre que consommer de la mémoire.
              </AlertDescription>
            </Alert>

            <SideSection
              icon={<Monitor className="size-4" />}
              title="Client uniquement"
              hint="Rendu, interface, confort visuel. À ne pas envoyer sur le serveur."
              items={summary.clientOnly}
            />
            <SideSection
              icon={<Server className="size-4" />}
              title="Serveur uniquement"
              hint="Génération de monde, logique de jeu. Inutile côté client."
              items={summary.serverOnly}
            />
            <SideSection
              icon={<Split className="size-4" />}
              title="Les deux côtés"
              hint="Doivent être présents des deux côtés, dans la même version, sinon la connexion est refusée."
              items={summary.shared}
            />
          </TabsContent>

          <TabsContent value="deps" className="mt-4">
            {summary.dependencies.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                Aucune dépendance n&apos;a eu besoin d&apos;être ajoutée.
              </p>
            ) : (
              <div className="divide-y rounded-lg border">
                {summary.dependencies.map((i) => (
                  <div key={i.key} className="p-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{i.name}</span>
                      <Badge variant="outline">{CONTENT_INFO[i.kind].label}</Badge>
                      <span className="text-muted-foreground font-mono text-[11px]">
                        {i.versionNumber}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs text-pretty">
                      Exigée par {i.requiredBy.length ? i.requiredBy.join(", ") : "un autre contenu"}.
                    </p>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {summary.manualOnly.length > 0 && (
          <Alert variant="warning" className="mt-4">
            <Lock />
            <AlertTitle>
              {summary.manualOnly.length} élément
              {summary.manualOnly.length > 1 ? "s" : ""} à récupérer à la main
            </AlertTitle>
            <AlertDescription>
              {summary.manualOnly.map((i) => i.name).join(", ")} — leur auteur interdit la
              distribution par des tiers.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function SideSection({
  icon,
  title,
  hint,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  items: SummaryItem[];
}) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
        <Badge variant="outline">{items.length}</Badge>
      </h3>
      <p className="text-muted-foreground mt-0.5 mb-2 text-xs text-pretty">{hint}</p>
      <ItemList items={items} showKind />
    </section>
  );
}

function ItemList({ items, showKind }: { items: SummaryItem[]; showKind?: boolean }) {
  if (!items.length) {
    return <p className="text-muted-foreground py-3 text-sm">Aucun.</p>;
  }
  return (
    <div className="max-h-72 divide-y overflow-y-auto rounded-lg border">
      {items.map((i) => (
        <div key={i.key} className="flex items-start gap-3 p-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm">{i.name}</span>
              {showKind && <Badge variant="outline">{CONTENT_INFO[i.kind].label}</Badge>}
              {i.origin === "dependency" && <Badge variant="info">dépendance</Badge>}
              {i.origin === "manual" && <Badge variant="secondary">ajouté</Badge>}
              {i.unstable && <Badge variant="warning">non stable</Badge>}
              {i.manualOnly && <Badge variant="warning">manuel</Badge>}
            </div>
            <p className="text-muted-foreground mt-0.5 font-mono text-[11px]">
              {[i.versionNumber, i.provider, i.fileSize ? humanSize(i.fileSize) : ""]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {i.newerAvailable && (
              <p className="text-muted-foreground mt-0.5 text-[11px]">
                Plus récent mais non stable : {i.newerAvailable}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
