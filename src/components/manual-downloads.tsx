"use client";

import * as React from "react";
import {
  CircleCheck, ExternalLink, FolderOpen, Loader2, RefreshCw, Trash2, TriangleAlert, Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  canWatchFolder, chooseFolder, dropManualFile, matchFiles, scanFolder, watchedFolderName,
  type ManualFileInfo, type PendingDownload,
} from "@/lib/manual";
import { humanSize } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Recuperation des fichiers que l'API ne peut pas livrer.
 *
 * Meme principe que Prism Launcher : l'outil ouvre la page du fichier exact,
 * puis recupere ce qui a ete telecharge. Une page web ne peut pas lire le
 * dossier Telechargements toute seule — il faut soit un depot de fichiers,
 * soit une autorisation explicite donnee une fois.
 */
export function ManualDownloads({
  pending,
  have,
  onChange,
}: {
  pending: PendingDownload[];
  have: Record<string, ManualFileInfo>;
  onChange: (next: Record<string, ManualFileInfo>) => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [folder, setFolder] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [opened, setOpened] = React.useState<Set<string>>(new Set());
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    watchedFolderName().then(setFolder).catch(() => setFolder(null));
  }, []);

  const ingest = React.useCallback(
    async (files: { name: string; bytes: Uint8Array }[]) => {
      if (!files.length) {
        setMessage({ ok: false, text: "Aucun fichier exploitable dans la sélection." });
        return;
      }
      const { matched, unmatched } = await matchFiles(files, pending);
      const next = { ...have };
      for (const m of matched) next[m.key] = m.info;
      onChange(next);

      const doubtful = matched.filter((m) => !m.info.verified);
      setMessage({
        ok: matched.length > 0,
        text:
          matched.length === 0
            ? `Aucun des ${files.length} fichiers ne correspond à ce qui manque.`
            : `${matched.length} fichier(s) rattaché(s)` +
              (doubtful.length
                ? ` — dont ${doubtful.length} reconnu(s) par leur nom seulement, l'empreinte ne correspond pas.`
                : ", empreintes vérifiées.") +
              (unmatched.length ? ` ${unmatched.length} ignoré(s).` : ""),
      });
    },
    [pending, have, onChange],
  );

  async function fromFileList(list: FileList | null) {
    if (!list?.length) return;
    setBusy("depot");
    try {
      const files = await Promise.all(
        Array.from(list).map(async (f) => ({
          name: f.name,
          bytes: new Uint8Array(await f.arrayBuffer()),
        })),
      );
      await ingest(files);
    } finally {
      setBusy(null);
    }
  }

  async function rescan() {
    setBusy("scan");
    setMessage(null);
    try {
      const { files, denied } = await scanFolder(pending);
      if (denied) {
        setMessage({ ok: false, text: "Accès au dossier refusé ou expiré. Autorise-le à nouveau." });
        return;
      }
      await ingest(files);
    } finally {
      setBusy(null);
    }
  }

  const done = pending.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {done ? (
            <CircleCheck className="text-success size-4" />
          ) : (
            <Upload className="text-warning size-4" />
          )}
          Téléchargements manuels
          {!done && <Badge variant="warning">{pending.length}</Badge>}
        </CardTitle>
        <CardDescription>
          {done
            ? "Tout le contenu du pack est téléchargeable automatiquement."
            : "Ces auteurs interdisent la distribution de leur fichier par des tiers. " +
              "Ouvre la page — la bonne version est déjà sélectionnée — puis rends le fichier téléchargé."}
        </CardDescription>
      </CardHeader>

      {!done && (
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => {
                // Une page a la fois : un navigateur bloque les ouvertures
                // multiples issues d'un seul clic, seule la premiere passerait.
                const next = pending.find((p) => !opened.has(p.key) && p.pageUrl);
                if (!next) return;
                window.open(next.pageUrl, "_blank", "noopener,noreferrer");
                setOpened((s) => new Set(s).add(next.key));
              }}
              disabled={pending.every((p) => opened.has(p.key) || !p.pageUrl)}
            >
              <ExternalLink />
              {opened.size === 0
                ? "Ouvrir la premiere page"
                : `Page suivante (${Math.min(opened.size + 1, pending.length)}/${pending.length})`}
            </Button>

            <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={!!busy}>
              {busy === "depot" ? <Loader2 className="animate-spin" /> : <Upload />}
              Choisir les fichiers téléchargés
            </Button>

            {canWatchFolder() &&
              (folder ? (
                <>
                  <Button variant="outline" onClick={() => void rescan()} disabled={!!busy}>
                    {busy === "scan" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    Relire « {folder} »
                  </Button>
                  <Badge variant="secondary">dossier surveillé</Badge>
                </>
              ) : (
                <Button
                  variant="outline"
                  onClick={async () => {
                    const name = await chooseFolder();
                    setFolder(name);
                    if (name) await rescan();
                  }}
                  disabled={!!busy}
                >
                  <FolderOpen /> Autoriser le dossier Téléchargements
                </Button>
              ))}
          </div>

          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".jar,.zip,.litematic,.schem,.schematic,.nbt"
            className="hidden"
            onChange={(e) => {
              void fromFileList(e.target.files);
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
              void fromFileList(e.dataTransfer.files);
            }}
            className={cn(
              "rounded-lg border border-dashed p-4 text-center text-sm transition-colors",
              dragging ? "border-primary bg-primary/5" : "text-muted-foreground",
            )}
          >
            …ou dépose les fichiers ici, tous d&apos;un coup. Ils sont reconnus par leur empreinte,
            pas par leur nom : une mauvaise version est détectée.
          </div>

          {canWatchFolder() ? (
            <p className="text-muted-foreground text-xs text-pretty">
              Autoriser le dossier évite de resélectionner les fichiers à chaque fois : un clic sur
              « Relire » suffit ensuite. Seuls les fichiers dont l&apos;extension correspond à ce
              qui manque sont ouverts, et rien ne quitte la machine.
            </p>
          ) : (
            <p className="text-muted-foreground text-xs text-pretty">
              Ton navigateur ne permet pas de surveiller un dossier (c&apos;est le cas de Firefox et
              Safari). Le dépôt de fichiers fonctionne partout.
            </p>
          )}

          {message && (
            <Alert variant={message.ok ? "success" : "warning"}>
              {message.ok ? <CircleCheck /> : <TriangleAlert />}
              <AlertDescription>{message.text}</AlertDescription>
            </Alert>
          )}

          <div className="divide-y rounded-lg border">
            {pending.map((p) => (
              <div key={p.key} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{p.name}</span>
                    <Badge variant="outline">{p.kind}</Badge>
                    {p.reason === "distribution" ? (
                      <Badge variant="warning">distribution refusée</Badge>
                    ) : (
                      <Badge variant="destructive">téléchargement échoué</Badge>
                    )}
                    {opened.has(p.key) && <Badge variant="secondary">page ouverte</Badge>}
                  </div>
                  <p className="text-muted-foreground mt-0.5 font-mono text-[11px] break-all">
                    {p.fileName}
                    {p.fileSize ? ` · ${humanSize(p.fileSize)}` : ""} → {p.folder}/
                  </p>
                </div>
                {p.pageUrl && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      window.open(p.pageUrl, "_blank", "noopener,noreferrer");
                      setOpened((s) => new Set(s).add(p.key));
                    }}
                  >
                    <ExternalLink /> Page
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      )}

      {Object.keys(have).length > 0 && (
        <CardContent className={done ? undefined : "pt-0"}>
          <p className="mb-2 text-sm font-medium">
            {Object.keys(have).length} fichier(s) fourni(s) à la main
          </p>
          <div className="divide-y rounded-lg border">
            {Object.entries(have).map(([key, info]) => (
              <div key={key} className="flex items-center gap-3 p-2.5">
                <CircleCheck
                  className={cn("size-4 shrink-0", info.verified ? "text-success" : "text-warning")}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs">{info.fileName}</p>
                  <p className="text-muted-foreground text-[11px]">
                    {humanSize(info.size)} ·{" "}
                    {info.verified ? "empreinte vérifiée" : "empreinte inconnue, reconnu par le nom"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Retirer"
                  onClick={async () => {
                    await dropManualFile(key);
                    const next = { ...have };
                    delete next[key];
                    onChange(next);
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      )}

      {!done && (
        <CardContent className="pt-0">
          <Alert variant="info">
            <TriangleAlert />
            <AlertTitle>Pourquoi ce détour</AlertTitle>
            <AlertDescription>
              CurseForge expose bien ces fichiers, mais leur auteur a désactivé la distribution par
              des tiers. Passer outre serait techniquement possible et contraire à son choix : le
              pack se génère sans eux si tu préfères les installer toi-même plus tard.
            </AlertDescription>
          </Alert>
        </CardContent>
      )}
    </Card>
  );
}
