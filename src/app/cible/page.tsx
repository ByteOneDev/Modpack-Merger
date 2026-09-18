"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StepGuard } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useMerge } from "@/lib/store";
import { runAnalysis, type AnalyzeProgress } from "@/lib/analyze";
import { modrinth } from "@/lib/core/providers/modrinth";
import { LOADERS, LOADER_LABEL, type LoaderId, type MergeTarget } from "@/lib/core/types";
import { cn } from "@/lib/utils";

const LOADER_NOTE: Record<LoaderId, string> = {
  fabric: "leger, mises a jour rapides",
  neoforge: "successeur de Forge (1.20.2+)",
  forge: "ecosysteme historique",
  quilt: "charge aussi les mods Fabric",
};

export default function TargetPage() {
  const router = useRouter();
  const { state, setState, settings, hydrated } = useMerge();
  const [gameVersions, setGameVersions] = React.useState<string[]>([]);
  const [progress, setProgress] = React.useState<AnalyzeProgress | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const packs = state.packs;

  const detectedLoaders = React.useMemo(
    () => [...new Set(packs.map((p) => p.loader).filter(Boolean))] as LoaderId[],
    [packs],
  );
  const detectedVersions = React.useMemo(
    () => [...new Set(packs.map((p) => p.minecraft).filter(Boolean))] as string[],
    [packs],
  );

  const [target, setTarget] = React.useState<MergeTarget>({
    loader: "fabric",
    minecraft: "",
    name: "Modpack fusionne",
    version: "1.0.0",
    author: "",
  });

  // Pre-remplissage a partir de ce qui a ete detecte dans les archives, ou
  // reprise de la cible precedente si l'utilisateur revient sur cette etape.
  const primed = React.useRef(false);
  React.useEffect(() => {
    if (primed.current || !packs.length) return;
    primed.current = true;
    setTarget((t) =>
      state.target ?? {
        ...t,
        loader: detectedLoaders[0] ?? t.loader,
        minecraft: detectedVersions[0] ?? t.minecraft,
        name: packs.map((p) => p.name).join(" + ").slice(0, 60),
      },
    );
  }, [packs, detectedLoaders, detectedVersions, state.target]);

  React.useEffect(() => {
    modrinth
      .gameVersions()
      .then((v) => setGameVersions(v.slice(0, 80)))
      .catch(() => setGameVersions([]));
  }, []);

  const versionOptions = React.useMemo(
    () => [...new Set([...detectedVersions, ...gameVersions])],
    [detectedVersions, gameVersions],
  );

  async function analyze() {
    setError(null);
    setProgress({ phase: "Demarrage", done: 0, total: 1 });
    try {
      const result = await runAnalysis(packs, target, settings, setProgress);
      setState((prev) => ({ ...prev, ...result, target }));
      router.push("/mods/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "L'analyse a echoue.");
      setProgress(null);
    }
  }

  if (!hydrated) return null;
  if (packs.length < 2) {
    return (
      <StepGuard
        title="Aucun modpack charge"
        description="Il faut au moins deux archives pour lancer une fusion."
        href="/"
        cta="Choisir mes modpacks"
      />
    );
  }

  const running = progress !== null;
  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Vers quelle configuration fusionner ?"
        description="Chaque mod sera recherche dans cette combinaison exacte de mod loader et de version de Minecraft."
      />

      {detectedLoaders.length > 1 && (
        <Alert variant="warning" className="mb-6">
          <TriangleAlert />
          <AlertTitle>Tes packs melangent {detectedLoaders.join(" et ")}</AlertTitle>
          <AlertDescription>
            Un mod compile pour l&apos;un ne se charge pas sur l&apos;autre. Choisis la base : les
            mods des autres packs seront cherches dans leur version equivalente, et ceux qui
            n&apos;existent pas te seront signales avec des alternatives.
          </AlertDescription>
        </Alert>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Mod loader</CardTitle>
          <CardDescription>La base technique du pack fusionne.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {LOADERS.map((id) => {
              const selected = target.loader === id;
              return (
                <button
                  key={id}
                  type="button"
                  // Le choix n'etait signale que par la bordure : un lecteur
                  // d'ecran ne pouvait pas dire quel loader est retenu.
                  aria-pressed={selected}
                  onClick={() => setTarget((t) => ({ ...t, loader: id }))}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    selected
                      ? "border-primary bg-primary/5 ring-primary/20 ring-2"
                      : "hover:border-muted-foreground/40",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{LOADER_LABEL[id]}</span>
                    {detectedLoaders.includes(id) && <Badge variant="info">detecte</Badge>}
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">{LOADER_NOTE[id]}</p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Identite du pack</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="mc">Version de Minecraft</Label>
            <Select
              value={target.minecraft}
              onValueChange={(v) => setTarget((t) => ({ ...t, minecraft: v }))}
            >
              <SelectTrigger id="mc">
                <SelectValue placeholder="Choisir une version" />
              </SelectTrigger>
              <SelectContent>
                {versionOptions.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                    {detectedVersions.includes(v) ? "  · detectee" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Nom du pack</Label>
            <Input
              id="name"
              value={target.name}
              onChange={(e) => setTarget((t) => ({ ...t, name: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="version">Version du pack</Label>
            <Input
              id="version"
              value={target.version}
              onChange={(e) => setTarget((t) => ({ ...t, version: e.target.value }))}
              placeholder="1.0.0"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="author">Auteur</Label>
            <Input
              id="author"
              value={target.author}
              onChange={(e) => setTarget((t) => ({ ...t, author: e.target.value }))}
              placeholder="ton pseudo"
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <TriangleAlert />
          <AlertTitle>L&apos;analyse a echoue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {running ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="size-4 animate-spin" />
              {progress.phase}
              {progress.total > 1 && (
                <span className="text-muted-foreground font-normal">
                  {progress.done} / {progress.total}
                </span>
              )}
            </div>
            <Progress value={pct} />
            <p className="text-muted-foreground text-xs">
              Chaque mod est cherche sur Modrinth et CurseForge, puis ses dependances. Sur un gros
              pack, compte une a deux minutes.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Button size="lg" disabled={!target.minecraft} onClick={() => void analyze()}>
          <Sparkles /> Lancer la fusion <ArrowRight />
        </Button>
      )}
    </>
  );
}
