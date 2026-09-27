"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Laptop, Server, ServerCog } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StepGuard } from "@/components/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ModSideList } from "@/components/sides/mod-side-list";
import { ConfigEditorPanel } from "@/components/sides/config-editor-panel";
import { useMerge } from "@/lib/store";
import { humanSize } from "@/lib/format";
import { effectiveSide, includedIn, type PackTarget, type Side } from "@/lib/core/sides";
import { cn } from "@/lib/utils";

/**
 * Pour qui est le pack : les joueurs, le serveur, ou les deux.
 *
 * Derniere etape avant l'export : on y decide ce qui part de chaque cote,
 * et on peut retoucher les fichiers de configuration tels qu'ils seront
 * livres.
 */
export default function SidePage() {
  const router = useRouter();
  const { state, setState, hydrated } = useMerge();

  if (!hydrated) return null;
  if (!state.analyzed || !state.target) {
    return (
      <StepGuard
        title="Fusion pas encore calculee"
        description="Le côté de chaque mod se choisit une fois la fusion calculée."
        href="/cible/"
        cta="Configurer la cible"
      />
    );
  }

  const overrides = state.sideOverrides ?? {};
  const target = state.packTarget ?? "both";
  const kept = state.resolutions.filter(
    (r) => (r.status === "ok" || r.status === "substituted") && r.picked,
  );
  const stats = (dist: "client" | "server") => {
    const list = kept.filter((r) => includedIn(effectiveSide(r, overrides), dist));
    return {
      count: list.length,
      bytes: list.reduce((n, r) => n + (r.picked?.fileSize ?? 0), 0),
    };
  };
  const client = stats("client");
  const server = stats("server");

  const setTarget = (t: PackTarget) => setState((prev) => ({ ...prev, packTarget: t }));
  const setOverrides = (next: Record<string, Side>) =>
    setState((prev) => ({ ...prev, sideOverrides: next }));
  const saveEdit = (path: string, text: string | null) =>
    setState((prev) => {
      const configEdits = { ...(prev.configEdits ?? {}) };
      if (text === null) delete configEdits[path];
      else configEdits[path] = text;
      return { ...prev, configEdits };
    });

  const OPTIONS: {
    id: PackTarget;
    title: string;
    icon: React.ElementType;
    detail: string;
    meta: string;
  }[] = [
    {
      id: "client",
      title: "Client seul",
      icon: Laptop,
      detail: "Un pack pour le lanceur des joueurs. Les mods purement serveur sont retirés.",
      meta: `${client.count} éléments · ${humanSize(client.bytes)}`,
    },
    {
      id: "server",
      title: "Serveur seul",
      icon: Server,
      detail:
        "Un zip à décompresser dans le dossier du serveur. Les mods d'affichage, resource packs et shaders sont retirés.",
      meta: `${server.count} éléments · ${humanSize(server.bytes)}`,
    },
    {
      id: "both",
      title: "Les deux",
      icon: ServerCog,
      detail: "Les deux archives, générées ensemble : celle des joueurs et celle du serveur.",
      meta: `${client.count} + ${server.count} éléments · 2 archives`,
    },
  ];

  return (
    <>
      <PageHeader
        title="Pour les joueurs, pour le serveur, ou les deux ?"
        description="Chaque mod part du côté où il sert. Vérifie ceux que les plateformes ne renseignent pas, et retouche les configurations avant l'export."
        action={
          <Button onClick={() => router.push("/export/")}>
            Continuer <ArrowRight />
          </Button>
        }
      />

      <fieldset className="mb-8">
        <legend className="mb-3 text-lg font-semibold">Ce que tu veux produire</legend>
        <div className="grid gap-3 md:grid-cols-3">
          {OPTIONS.map((o) => (
            <label
              key={o.id}
              className={cn(
                "flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors",
                "has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-2",
                target === o.id ? "border-primary bg-primary/5 ring-primary/20 ring-2" : "hover:bg-muted/50",
              )}
            >
              <input
                type="radio"
                name="pack-target"
                value={o.id}
                checked={target === o.id}
                onChange={() => setTarget(o.id)}
                className="accent-primary mt-1 size-4 shrink-0"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-medium">
                  <o.icon className="text-muted-foreground size-4" aria-hidden />
                  {o.title}
                </span>
                <span className="text-muted-foreground mt-1 block text-sm text-pretty">{o.detail}</span>
                <span className="mt-2 block text-xs font-medium tabular-nums">{o.meta}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Côté de chaque élément</CardTitle>
          <CardDescription>
            « Client » : seulement chez les joueurs (minimap, interface, shaders). « Serveur » :
            seulement sur le serveur. « Les deux » : partout — c&apos;est le cas de la plupart des
            mods qui ajoutent du contenu.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ModSideList
            resolutions={state.resolutions}
            overrides={overrides}
            target={target}
            onChange={setOverrides}
          />
        </CardContent>
      </Card>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Fichiers de configuration</CardTitle>
          <CardDescription>
            Le contenu affiché est celui qui partira dans l&apos;archive, fusions et choix du centre
            de conflits compris. Tes modifications le remplacent à l&apos;export ; l&apos;original
            reste intact et peut être rétabli.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConfigEditorPanel
            packs={state.packs}
            decisions={state.decisions}
            edits={state.configEdits ?? {}}
            onSave={saveEdit}
          />
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={() => router.push("/export/")}>
          Continuer vers l&apos;export <ArrowRight />
        </Button>
        <Button variant="outline" onClick={() => router.push("/conflits/")}>
          Retour aux conflits
        </Button>
      </div>
    </>
  );
}
