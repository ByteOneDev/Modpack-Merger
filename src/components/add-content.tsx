"use client";

import * as React from "react";
import {
  Boxes, Check, ExternalLink, Image as ImageIcon, Loader2, Package, Plus, Scroll, Search,
  Sparkles, TriangleAlert, Upload,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { searchAll } from "@/lib/core/providers";
import { CONTENT_INFO, type ContentKind } from "@/lib/core/content";
import { LOADER_COMPAT, type MergeTarget, type ProviderId, type ProviderProject } from "@/lib/core/types";
import { humanDownloads } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICON: Record<ContentKind, React.ReactNode> = {
  mod: <Package className="size-4" />,
  resourcepack: <ImageIcon className="size-4" />,
  shaderpack: <Sparkles className="size-4" />,
  datapack: <Scroll className="size-4" />,
  schematic: <Boxes className="size-4" />,
};

const PLACEHOLDER: Record<ContentKind, string> = {
  mod: "Nom du mod, ex. Create, Waystones, Iris…",
  resourcepack: "Nom du resource pack, ex. Faithful, Stay True…",
  shaderpack: "Nom du shader, ex. Complementary, BSL, Rethinking Voxels…",
  datapack: "Nom du datapack, ex. Terralith, Nullscape…",
  schematic: "",
};

/** Bibliothèques de schématiques, ouvertes dans un onglet. */
const SCHEMATIC_LIBRARIES = [
  { name: "Minecraft-Schematics", url: "https://www.minecraft-schematics.com/", note: "fermes, bâtiments, redstone" },
  { name: "Planet Minecraft", url: "https://www.planetminecraft.com/projects/", note: "projets communautaires" },
  { name: "Grabcraft", url: "https://www.grabcraft.com/", note: "plans détaillés" },
];

export interface AddedSchematic {
  name: string;
  size: number;
  bytes: Uint8Array;
}

/**
 * Ajout de contenu au pack, tous types confondus.
 *
 * Chaque type se cherche differemment : un resource pack n'est pas publie
 * sous un mod loader, un shader l'est sous Iris ou OptiFine. Le champ de
 * recherche est le meme, ce qu'il interroge ne l'est pas.
 */
export function AddContent({
  target,
  onAdd,
  onAddSchematics,
  schematicFolder,
  schematicMod,
}: {
  target: MergeTarget;
  onAdd: (
    provider: ProviderId,
    projectId: string,
    kind: ContentKind,
  ) => Promise<{ error?: string; addedName?: string; addedDeps?: number }>;
  onAddSchematics: (files: AddedSchematic[]) => void;
  /** dossier de destination impose par le mod detecte */
  schematicFolder: string;
  /** nom du mod a schematiques detecte, s'il y en a un */
  schematicMod: string | null;
}) {
  const [kind, setKind] = React.useState<ContentKind>("mod");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ajouter du contenu</CardTitle>
        <CardDescription>
          Mods, resource packs, shaders, datapacks et schématiques. Tout est ajouté dans sa version
          la plus récente compatible avec {target.loader} {target.minecraft}, dépendances comprises.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <Tabs value={kind} onValueChange={(v) => setKind(v as ContentKind)}>
          {/* h-auto : sans cela la hauteur reste figee et la troisieme rangee
              d'onglets recouvre le texte, sur telephone. */}
          <TabsList className="h-auto flex-wrap justify-start">
            {(Object.keys(CONTENT_INFO) as ContentKind[]).map((k) => (
              <TabsTrigger key={k} value={k} className="gap-1.5">
                {ICON[k]}
                {CONTENT_INFO[k].plural}
              </TabsTrigger>
            ))}
          </TabsList>

          {(Object.keys(CONTENT_INFO) as ContentKind[]).map((k) => (
            <TabsContent key={k} value={k} className="mt-4">
              <p className="text-muted-foreground mb-3 text-xs text-pretty">
                {CONTENT_INFO[k].hint} Destination :{" "}
                <code className="font-mono">
                  {k === "schematic" ? schematicFolder : CONTENT_INFO[k].folder}/
                </code>
              </p>

              {k === "schematic" ? (
                <SchematicPanel
                  folder={schematicFolder}
                  detectedMod={schematicMod}
                  onAdd={onAddSchematics}
                />
              ) : (
                <SearchPanel kind={k} target={target} onAdd={onAdd} />
              )}
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}

function SearchPanel({
  kind,
  target,
  onAdd,
}: {
  kind: ContentKind;
  target: MergeTarget;
  onAdd: (
    provider: ProviderId,
    projectId: string,
    kind: ContentKind,
  ) => Promise<{ error?: string; addedName?: string; addedDeps?: number }>;
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<ProviderProject[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [adding, setAdding] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    // Recherche differee : l'utilisateur tape vite, les APIs sont limitees.
    const t = setTimeout(() => {
      setSearching(true);
      searchAll(q, LOADER_COMPAT[target.loader], target.minecraft, 20, kind)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(t);
  }, [query, kind, target.loader, target.minecraft]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={PLACEHOLDER[kind]}
          className="pl-9"
        />
      </div>

      {message && (
        <Alert variant={message.ok ? "success" : "destructive"}>
          {message.ok ? <Check /> : <TriangleAlert />}
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      {searching && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Recherche…
        </p>
      )}

      {results.length > 0 && (
        <div className="max-h-80 divide-y overflow-y-auto rounded-lg border">
          {results.map((p) => (
            <div key={`${p.provider}-${p.projectId}`} className="flex items-start gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{p.title}</span>
                  <Badge variant="outline">{p.provider}</Badge>
                  {p.allowDistribution === false && (
                    <Badge variant="warning">téléchargement manuel</Badge>
                  )}
                  <span className="text-muted-foreground font-mono text-[11px]">
                    {humanDownloads(p.downloads)} dl
                  </span>
                </div>
                <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs text-pretty">
                  {p.description}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={adding !== null}
                onClick={async () => {
                  setAdding(p.projectId);
                  setMessage(null);
                  try {
                    const r = await onAdd(p.provider, p.projectId, p.kind ?? kind);
                    setMessage(
                      r.error
                        ? { ok: false, text: r.error }
                        : {
                            ok: true,
                            text:
                              `${r.addedName} ajouté` +
                              (r.addedDeps ? ` avec ${r.addedDeps} dépendance(s).` : "."),
                          },
                    );
                  } finally {
                    setAdding(null);
                  }
                }}
              >
                {adding === p.projectId ? <Loader2 className="animate-spin" /> : <Plus />}
                Ajouter
              </Button>
            </div>
          ))}
        </div>
      )}

      {!searching && query.trim().length >= 2 && results.length === 0 && (
        <p className="text-muted-foreground text-sm">
          Aucun résultat pour Minecraft {target.minecraft}.
        </p>
      )}
    </div>
  );
}

/**
 * Les schematiques n'ont pas d'API.
 *
 * Aucune des bibliotheques connues n'expose d'interface interrogeable depuis
 * un navigateur : minecraft-schematics.com repond derriere une protection
 * anti-robot et sans en-tetes CORS, et ni Modrinth ni CurseForge n'ont de
 * categorie pour ce type de fichier. On ouvre donc la bibliotheque, et on
 * recupere le fichier — meme approche que pour les mods non distribuables.
 */
function SchematicPanel({
  folder,
  detectedMod,
  onAdd,
}: {
  folder: string;
  detectedMod: string | null;
  onAdd: (files: AddedSchematic[]) => void;
}) {
  const [dragging, setDragging] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function take(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    try {
      const accepted: AddedSchematic[] = [];
      const rejected: string[] = [];
      for (const f of Array.from(list)) {
        if (!CONTENT_INFO.schematic.extensions.some((e) => f.name.toLowerCase().endsWith(e))) {
          rejected.push(f.name);
          continue;
        }
        accepted.push({
          name: f.name,
          size: f.size,
          bytes: new Uint8Array(await f.arrayBuffer()),
        });
      }
      if (accepted.length) onAdd(accepted);
      setMessage(
        `${accepted.length} schématique(s) ajoutée(s)` +
          (rejected.length ? ` · ${rejected.length} fichier(s) ignoré(s) : extension inconnue.` : "."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {detectedMod ? (
        <Alert variant="success">
          <Check />
          <AlertTitle>{detectedMod} détecté dans le pack</AlertTitle>
          <AlertDescription>
            Les schématiques ajoutées iront dans <code className="font-mono">{folder}/</code>, où{" "}
            {detectedMod} les lit au démarrage.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>Aucun mod à schématiques dans le pack</AlertTitle>
          <AlertDescription>
            Sans Litematica, WorldEdit, Schematica ou Axiom, les fichiers seront livrés dans{" "}
            <code className="font-mono">{folder}/</code> mais rien ne pourra les ouvrir. Ajoute
            d&apos;abord un de ces mods dans l&apos;onglet Mods.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Upload />}
          Choisir des fichiers
        </Button>
        {SCHEMATIC_LIBRARIES.map((lib) => (
          <Button
            key={lib.url}
            variant="outline"
            title={lib.note}
            onClick={() => window.open(lib.url, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink /> {lib.name}
          </Button>
        ))}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".litematic,.schem,.schematic,.nbt"
        className="hidden"
        onChange={(e) => {
          void take(e.target.files);
          e.target.value = "";
        }}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void take(e.dataTransfer.files);
        }}
        className={cn(
          "rounded-lg border border-dashed p-6 text-center text-sm transition-colors",
          dragging ? "border-primary bg-primary/5" : "text-muted-foreground",
        )}
      >
        Dépose ici des fichiers <code className="font-mono">.litematic</code>,{" "}
        <code className="font-mono">.schem</code>, <code className="font-mono">.schematic</code> ou{" "}
        <code className="font-mono">.nbt</code>.
      </div>

      {message && (
        <Alert variant="success">
          <Check />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      <p className="text-muted-foreground text-xs text-pretty">
        Aucune bibliothèque de schématiques n&apos;expose d&apos;API utilisable depuis un
        navigateur, et ni Modrinth ni CurseForge n&apos;ont de catégorie pour ce format : la
        recherche automatique n&apos;est donc pas possible. Les boutons ci-dessus ouvrent les
        bibliothèques, le fichier téléchargé se dépose ensuite ici.
      </p>
    </div>
  );
}
