"use client";

import * as React from "react";
import { FileCode2, Loader2, RotateCcw, Save, Search, TriangleAlert, Undo2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CodeEditor } from "@/components/sides/code-editor";
import { editableFiles, loadFinalFile, type FinalFile } from "@/lib/conflict-files";
import { fileSide } from "@/lib/core/sides";
import { validateConfig } from "@/lib/validate-config";
import { cn } from "@/lib/utils";
import type { OverrideDecision, ParsedPack } from "@/lib/core/types";

const LIST_LIMIT = 300;

/** Chemin lisible : sans le dossier overrides/ qui n'existe pas dans l'instance. */
const display = (path: string) => path.replace(/^(client-|server-)?overrides\//, "");

/**
 * Edition des fichiers de configuration avant l'export.
 *
 * L'editeur part du fichier tel qu'il sera livre : la version retenue, ou
 * le resultat de la fusion. La modification est gardee a part et remplace
 * ce fichier dans chaque archive ; l'original n'est jamais touche, on peut
 * toujours y revenir.
 */
export function ConfigEditorPanel({
  packs,
  decisions,
  edits,
  onSave,
}: {
  packs: ParsedPack[];
  decisions: Record<string, OverrideDecision>;
  edits: Record<string, string>;
  /** texte a garder, ou null pour revenir a l'original */
  onSave: (path: string, text: string | null) => void;
}) {
  const files = React.useMemo(() => editableFiles(packs), [packs]);
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<string | null>(null);
  const [file, setFile] = React.useState<FinalFile | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  // L'editeur garde son propre texte : pour y remettre un autre contenu
  // (annuler, revenir a l'original), on le recree.
  const [revision, setRevision] = React.useState(0);

  const baseline = selected ? (edits[selected] ?? file?.text ?? "") : "";
  const dirty = !!selected && file?.text != null && draft !== baseline;

  React.useEffect(() => {
    if (!selected) return;
    let vivant = true;
    setLoading(true);
    setError(null);
    setStatus(null);
    loadFinalFile(packs, selected, decisions[selected])
      .then((f) => {
        if (!vivant) return;
        setFile(f);
        setDraft(edits[selected] ?? f?.text ?? "");
      })
      .catch((e) => vivant && setError(e instanceof Error ? e.message : "Lecture impossible."))
      .finally(() => vivant && setLoading(false));
    return () => {
      vivant = false;
    };
    // Relu seulement quand on change de fichier : les modifications
    // enregistrees sont deja dans `draft`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const open = (path: string) => {
    if (path === selected) return;
    if (dirty && !window.confirm("Les modifications non enregistrées de ce fichier seront perdues. Continuer ?")) {
      return;
    }
    setSelected(path);
  };

  const save = (force = false) => {
    if (!selected) return;
    const problem = validateConfig(selected, draft);
    if (problem && !force) {
      setError(problem);
      return;
    }
    setError(null);
    // Revenir exactement au contenu d'origine, c'est ne plus rien modifier.
    onSave(selected, draft === file?.text ? null : draft);
    setStatus("Enregistré. La modification sera appliquée à l'export.");
  };

  const restoreOriginal = () => {
    if (!selected) return;
    onSave(selected, null);
    setDraft(file?.text ?? "");
    setRevision((r) => r + 1);
    setError(null);
    setStatus("Fichier d'origine rétabli.");
  };

  const q = query.trim().toLowerCase();
  const shown = q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files;
  const editedCount = Object.keys(edits).length;

  if (!files.length) {
    return (
      <p className="text-muted-foreground rounded-lg border p-6 text-center text-sm">
        Aucun fichier de configuration dans ces packs.
      </p>
    );
  }

  return (
    <div className="grid min-h-[28rem] overflow-hidden rounded-lg border md:grid-cols-[18rem_1fr]">
      <nav aria-label="Fichiers de configuration" className="flex min-h-0 flex-col border-b md:border-r md:border-b-0">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden />
            <Input
              type="search"
              aria-label="Chercher un fichier"
              placeholder={`${files.length} fichiers…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 pl-8 text-sm"
            />
          </div>
          {editedCount > 0 && (
            <p className="text-muted-foreground mt-1.5 px-1 text-xs">
              {editedCount} fichier{editedCount > 1 ? "s" : ""} modifié{editedCount > 1 ? "s" : ""}
            </p>
          )}
        </div>
        <ul className="max-h-80 flex-1 overflow-y-auto p-1 md:max-h-[34rem]">
          {shown.slice(0, LIST_LIMIT).map((f) => (
            <li key={f.path}>
              <button
                type="button"
                aria-current={f.path === selected ? "true" : undefined}
                onClick={() => open(f.path)}
                className={cn(
                  "focus-visible:ring-ring flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left font-mono text-xs break-all focus-visible:ring-2 focus-visible:outline-none",
                  f.path === selected ? "bg-primary/10 text-primary" : "hover:bg-muted",
                )}
              >
                <span className="min-w-0 flex-1">{display(f.path)}</span>
                {f.path in edits && (
                  <Badge variant="info" className="font-sans">
                    modifié
                  </Badge>
                )}
              </button>
            </li>
          ))}
          {shown.length > LIST_LIMIT && (
            <li className="text-muted-foreground px-2 py-2 text-xs">
              {shown.length - LIST_LIMIT} autres : affine la recherche.
            </li>
          )}
          {!shown.length && (
            <li className="text-muted-foreground px-2 py-4 text-center text-xs">Aucun fichier.</li>
          )}
        </ul>
      </nav>

      <section aria-label="Éditeur" className="flex min-h-0 min-w-0 flex-col">
        {!selected ? (
          <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm">
            <FileCode2 className="size-6" aria-hidden />
            Choisis un fichier à gauche pour le modifier.
          </div>
        ) : (
          <>
            <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
              <span className="min-w-0 flex-1 font-mono text-xs break-all">{display(selected)}</span>
              {file && <Badge variant="outline">pack{file.from.length > 1 ? "s" : ""} {file.from.join(", ")}</Badge>}
              {fileSide(selected) !== "both" && (
                <Badge variant="outline">{fileSide(selected) === "client" ? "client uniquement" : "serveur uniquement"}</Badge>
              )}
              {selected in edits && <Badge variant="info">modifié</Badge>}
            </header>

            <div className="min-h-72 flex-1">
              {loading ? (
                <p className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm" role="status">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Lecture du fichier…
                </p>
              ) : !file ? (
                <p className="text-muted-foreground p-6 text-sm">Fichier introuvable dans les archives.</p>
              ) : file.text == null ? (
                <p className="text-muted-foreground p-6 text-sm">
                  Fichier binaire, trop volumineux, ou retiré par une décision du centre de conflits :
                  il ne peut pas être modifié ici.
                </p>
              ) : (
                <CodeEditor
                  key={`${selected}:${revision}`}
                  path={selected}
                  initial={draft}
                  onChange={setDraft}
                  label={`Contenu de ${display(selected)}`}
                />
              )}
            </div>

            {error && (
              <Alert variant="destructive" className="m-3 mb-0">
                <TriangleAlert />
                <AlertDescription>
                  <p>{error}</p>
                  <p className="mt-1">
                    Un mod qui lit un fichier invalide plante, ou le remplace par ses valeurs par
                    défaut.
                  </p>
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => save(true)}>
                    Enregistrer quand même
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <footer className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
              <Button size="sm" disabled={!dirty} onClick={() => save()}>
                <Save /> Enregistrer
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!dirty}
                onClick={() => {
                  setDraft(baseline);
                  setRevision((r) => r + 1);
                  setError(null);
                }}
              >
                <Undo2 /> Annuler
              </Button>
              {selected in edits && (
                <Button size="sm" variant="ghost" onClick={restoreOriginal}>
                  <RotateCcw /> Revenir à l&apos;original
                </Button>
              )}
              <span className="text-muted-foreground ml-auto text-xs" role="status" aria-live="polite">
                {dirty ? "Modifications non enregistrées" : status}
              </span>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
