"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight, ArrowUp, ArrowDown, FileArchive, Loader2, Plus,
  Trash2, TriangleAlert, Upload,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMerge } from "@/lib/store";
import { saveArchive, dropArchive } from "@/lib/archives";
import { parsePack } from "@/lib/core/parse";
import { humanSize, packLabel } from "@/lib/format";
import type { ParsedPack } from "@/lib/core/types";

const FORMAT_LABEL: Record<string, string> = {
  mrpack: "Modrinth",
  curseforge: "CurseForge",
  raw: "Archive brute",
};

export default function PacksPage() {
  const router = useRouter();
  const { state, setState, hydrated } = useMerge();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const packs = state.packs;

  async function addFiles(files: FileList | File[]) {
    setError(null);
    const list = [...files].filter((f) => /\.(zip|mrpack)$/i.test(f.name));
    if (!list.length) {
      setError("Formats acceptes : .zip et .mrpack.");
      return;
    }

    for (const file of list) {
      setBusy(file.name);
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const packId = crypto.randomUUID();
        // L'etiquette depend de la position finale : on la recalcule apres coup.
        const pack = await parsePack(buf, file.name, { packId, label: "?" });
        await saveArchive(packId, file);
        setState((prev) => {
          const next = [...prev.packs, pack];
          return { ...prev, packs: relabel(next), analyzed: false };
        });
      } catch (err) {
        setError(
          `Impossible de lire ${file.name} : ${err instanceof Error ? err.message : "archive illisible"}`,
        );
      } finally {
        setBusy(null);
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function move(index: number, delta: number) {
    setState((prev) => {
      const next = [...prev.packs];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...prev, packs: relabel(next) };
    });
  }

  async function remove(pack: ParsedPack) {
    await dropArchive(pack.id);
    setState((prev) => ({
      ...prev,
      packs: relabel(prev.packs.filter((p) => p.id !== pack.id)),
      analyzed: false,
    }));
  }

  const loaders = [...new Set(packs.map((p) => p.loader).filter(Boolean))];
  const versions = [...new Set(packs.map((p) => p.minecraft).filter(Boolean))];
  const totalMods = packs.reduce((a, p) => a + p.mods.length, 0);

  if (!hydrated) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-16 text-sm">
        <Loader2 className="size-4 animate-spin" /> Chargement…
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Quels modpacks veux-tu fusionner ?"
        description="Ajoute au moins deux archives. Tout se passe dans ton navigateur : rien n'est envoye sur un serveur."
      />

      {error && (
        <Alert variant="destructive" className="mb-6">
          <TriangleAlert />
          <AlertTitle>Lecture impossible</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`mb-6 cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          dragging ? "border-primary bg-primary/5" : "hover:border-muted-foreground/40"
        }`}
      >
        <Upload className="text-muted-foreground mx-auto mb-3 size-7" />
        <p className="font-medium">Depose tes modpacks ici</p>
        <p className="text-muted-foreground mt-1 text-sm">
          ou clique pour les choisir · <code className="font-mono text-xs">.mrpack</code>,{" "}
          <code className="font-mono text-xs">.zip</code> CurseForge, ou une archive contenant un
          dossier <code className="font-mono text-xs">mods/</code>
        </p>
        {busy && (
          <p className="text-muted-foreground mt-3 flex items-center justify-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> Lecture de {busy}…
          </p>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".zip,.mrpack,application/zip"
          hidden
          onChange={(e) => e.target.files && void addFiles(e.target.files)}
        />
      </div>

      {packs.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>
              {packs.length} pack{packs.length > 1 ? "s" : ""} · {totalMods} mods au total
            </CardTitle>
            <CardDescription>
              L&apos;ordre compte : en cas de valeur contradictoire dans un fichier de
              configuration, le pack le plus haut l&apos;emporte.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {packs.map((pack, i) => (
              <div
                key={pack.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
              >
                <Badge variant="secondary" className="size-7 shrink-0 justify-center text-sm">
                  {pack.label}
                </Badge>

                <div className="min-w-48 flex-1">
                  <div className="flex items-center gap-2">
                    <FileArchive className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="truncate text-sm font-medium">{pack.name}</span>
                  </div>
                  <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span>{FORMAT_LABEL[pack.format]}</span>
                    <span>·</span>
                    <span>{humanSize(pack.fileSize)}</span>
                    <span>·</span>
                    <span>{pack.mods.length} mods</span>
                    {pack.overridePaths.length > 0 && (
                      <>
                        <span>·</span>
                        <span>{pack.overridePaths.length} fichiers</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Badge variant={pack.loader ? "info" : "warning"}>
                    {pack.loader ?? "loader ?"}
                  </Badge>
                  <Badge variant={pack.minecraft ? "info" : "warning"}>
                    {pack.minecraft ?? "version ?"}
                  </Badge>
                </div>

                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label="Monter"
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={i === packs.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label="Descendre"
                  >
                    <ArrowDown />
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => void remove(pack)}
                        aria-label="Retirer"
                      >
                        <Trash2 />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Retirer ce pack</TooltipContent>
                  </Tooltip>
                </div>

                {pack.warnings.length > 0 && (
                  <ul className="text-warning basis-full space-y-1 pl-10 text-xs">
                    {pack.warnings.map((w, k) => (
                      <li key={k}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}

            <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              <Plus /> Ajouter un autre pack
            </Button>
          </CardContent>
        </Card>
      )}

      {packs.length >= 2 && loaders.length > 1 && (
        <Alert variant="warning" className="mb-6">
          <TriangleAlert />
          <AlertTitle>Ces packs n&apos;utilisent pas le meme mod loader</AlertTitle>
          <AlertDescription>
            {loaders.join(", ")} — un mod compile pour l&apos;un ne se charge pas sur l&apos;autre.
            Tu choisiras la base a l&apos;etape suivante, et chaque mod des autres packs sera
            recherche dans sa version equivalente.
          </AlertDescription>
        </Alert>
      )}

      {packs.length >= 2 && versions.length > 1 && (
        <Alert variant="warning" className="mb-6">
          <TriangleAlert />
          <AlertTitle>Versions de Minecraft differentes</AlertTitle>
          <AlertDescription>
            {versions.join(", ")} — tous les mods seront alignes sur la version que tu choisiras.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <Button disabled={packs.length < 2} onClick={() => router.push("/cible/")}>
          Continuer <ArrowRight />
        </Button>
        {packs.length === 1 && (
          <p className="text-muted-foreground text-sm">
            Ajoute un second pack : il en faut au moins deux pour fusionner.
          </p>
        )}
      </div>
    </>
  );
}

/** Reattribue A, B, C… selon l'ordre courant. */
function relabel(packs: ParsedPack[]): ParsedPack[] {
  return packs.map((p, i) => ({ ...p, label: packLabel(i) }));
}
