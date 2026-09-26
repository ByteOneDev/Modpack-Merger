"use client";

import * as React from "react";
import {
  ChevronDown, CircleHelp, FileCode2, Loader2, Sparkles, UserCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { diffLines, type DiffResult } from "@/lib/core/diff";
import { loadConflictSides, type SideContent } from "@/lib/conflict-files";
import { formatDate, humanSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OverrideConflict, OverrideDecision, ParsedPack } from "@/lib/core/types";

const KIND_LABEL: Record<OverrideConflict["kind"], string> = {
  json: "JSON",
  keyvalue: "config clé = valeur",
  text: "texte",
  binary: "binaire",
};

export type FileConflictStatus = "pending" | "auto" | "user";

export function fileConflictStatus(
  c: OverrideConflict,
  decision: OverrideDecision | undefined,
): FileConflictStatus {
  if (decision === undefined) return c.auto === false ? "pending" : "auto";
  return c.auto !== false && decision === c.suggestion ? "auto" : "user";
}

const STATUS: Record<FileConflictStatus, { label: string; icon: React.ElementType; variant: "warning" | "info" | "success" }> = {
  pending: { label: "À confirmer", icon: CircleHelp, variant: "warning" },
  auto: { label: "Réglé automatiquement", icon: Sparkles, variant: "info" },
  user: { label: "Choisi par toi", icon: UserCheck, variant: "success" },
};

/**
 * Un fichier fourni par plusieurs packs, avec des contenus differents.
 *
 * Chaque choix est ecrit en toutes lettres (quel pack, quelle date, quelle
 * taille) et se fait au clavier : ce sont des boutons radio natifs. L'apercu
 * des differences evite de trancher a l'aveugle entre deux fichiers de meme
 * taille.
 */
export function FileConflictCard({
  conflict: c,
  decision,
  packs,
  onDecide,
}: {
  conflict: OverrideConflict;
  decision: OverrideDecision | undefined;
  packs: ParsedPack[];
  onDecide: (decision: OverrideDecision) => void;
}) {
  const id = React.useId();
  const [showDiff, setShowDiff] = React.useState(false);
  const status = fileConflictStatus(c, decision);
  // Tant que le conflit attend une confirmation, le choix reste un brouillon :
  // les fleches du clavier changent de bouton radio, et valider a chaque
  // mouvement ferait disparaitre la carte sous le curseur.
  const [draft, setDraft] = React.useState<OverrideDecision | null>(null);
  const selected = draft ?? decision ?? c.suggestion;
  const choose = (d: OverrideDecision) => (status === "pending" ? setDraft(d) : onDecide(d));
  const packOf = (packId: string) => packs.find((p) => p.id === packId);

  const rel = c.path.replace(/^(client-|server-)?overrides\//, "");
  const slash = rel.lastIndexOf("/");
  const fileName = rel.slice(slash + 1);
  const folder = slash > 0 ? rel.slice(0, slash + 1) : "";
  const side = c.path.startsWith("client-") ? "client uniquement" : c.path.startsWith("server-") ? "serveur uniquement" : null;
  const winner = c.sides[0];
  const rare = selected === "all" || selected === "skip";
  const S = STATUS[status];

  return (
    <article
      aria-labelledby={`${id}-title`}
      className={cn(
        "rounded-lg border p-4",
        status === "pending" && "border-warning/60 bg-warning/5",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 id={`${id}-title`} className="flex items-center gap-2 font-medium break-all">
            <FileCode2 className="text-muted-foreground size-4 shrink-0" aria-hidden />
            {fileName}
          </h4>
          <p className="text-muted-foreground mt-0.5 font-mono text-xs break-all">
            {folder || "racine de l'instance"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{KIND_LABEL[c.kind] ?? c.kind}</Badge>
          {side && <Badge variant="outline">{side}</Badge>}
          <Badge variant={S.variant}>
            <S.icon aria-hidden /> {S.label}
          </Badge>
        </div>
      </header>

      <p className="text-muted-foreground mt-2 text-sm text-pretty">
        {c.rationale ?? "Plusieurs packs fournissent ce fichier avec un contenu différent."}
        {c.note && ` ${c.note}`}
      </p>

      <fieldset className="mt-3">
        <legend className="sr-only">Quelle version de {fileName} garder ?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {c.sides.map((s) => {
            const p = packOf(s.packId);
            return (
              <Choice
                key={s.packId}
                name={id}
                value={s.packId}
                checked={selected === s.packId}
                onChange={choose}
                title={`Version du pack ${s.label}`}
                subtitle={p?.name}
                meta={[
                  s.modified ? `modifiée le ${formatDate(s.modified)}` : "date inconnue",
                  humanSize(s.size),
                ]}
                badge={s.packId === c.newestPackId ? "la plus récente" : undefined}
              />
            );
          })}
          {c.mergeable && (
            <Choice
              name={id}
              value="merge"
              checked={selected === "merge"}
              onChange={choose}
              title="Fusionner les versions"
              subtitle="Garde toutes les clés de tous les packs"
              meta={[`valeur différente : le pack ${winner.label} l'emporte`]}
            />
          )}
        </div>

        <details className="group mt-2" open={rare}>
          <summary className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer list-none items-center gap-1 rounded text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
            Autres choix
          </summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Choice
              name={id}
              value="all"
              checked={selected === "all"}
              onChange={choose}
              title="Garder toutes les versions"
              subtitle={`Celle du pack ${winner.label} garde le nom, les autres sont renommées « .depuis-pack-X »`}
            />
            <Choice
              name={id}
              value="skip"
              checked={selected === "skip"}
              onChange={choose}
              title="N'inclure aucune version"
              subtitle="Le mod recréera sa configuration par défaut au premier lancement"
            />
          </div>
        </details>
      </fieldset>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {status === "pending" && (
          <Button size="sm" onClick={() => onDecide(selected)}>
            Valider ce choix
          </Button>
        )}
        {c.kind !== "binary" && (
          <Button
            size="sm"
            variant="outline"
            aria-expanded={showDiff}
            aria-controls={`${id}-diff`}
            onClick={() => setShowDiff((v) => !v)}
          >
            <ChevronDown className={cn("transition-transform", showDiff && "rotate-180")} aria-hidden />
            {showDiff ? "Masquer les différences" : "Voir les différences"}
          </Button>
        )}
      </div>

      {showDiff && (
        <div id={`${id}-diff`} className="mt-3">
          <DiffView conflict={c} packs={packs} />
        </div>
      )}
    </article>
  );
}

function Choice({
  name,
  value,
  checked,
  onChange,
  title,
  subtitle,
  meta,
  badge,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (v: string) => void;
  title: string;
  subtitle?: string;
  meta?: string[];
  badge?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors",
        "has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-2",
        checked ? "border-primary bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="accent-primary mt-0.5 size-4 shrink-0"
      />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5 font-medium">
          {title}
          {badge && <Badge variant="success">{badge}</Badge>}
        </span>
        {subtitle && <span className="text-muted-foreground block text-xs">{subtitle}</span>}
        {meta && meta.length > 0 && (
          <span className="text-muted-foreground mt-0.5 block text-xs">{meta.join(" · ")}</span>
        )}
      </span>
    </label>
  );
}

/** Differences entre la version de reference et une autre, au choix. */
function DiffView({ conflict: c, packs }: { conflict: OverrideConflict; packs: ParsedPack[] }) {
  const [contents, setContents] = React.useState<SideContent[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [other, setOther] = React.useState(c.sides[1]?.packId ?? "");
  const ref = c.sides[0];

  React.useEffect(() => {
    let vivant = true;
    loadConflictSides(packs, c.path, c.sides.map((s) => s.packId))
      .then((r) => vivant && setContents(r))
      .catch((e) => vivant && setError(e instanceof Error ? e.message : "Lecture impossible."));
    return () => {
      vivant = false;
    };
  }, [packs, c.path, c.sides]);

  const result: DiffResult | null = React.useMemo(() => {
    if (!contents) return null;
    const a = contents.find((s) => s.packId === ref.packId)?.text;
    const b = contents.find((s) => s.packId === other)?.text;
    if (a == null || b == null) return null;
    return diffLines(a, b);
  }, [contents, ref.packId, other]);

  if (error) return <p className="text-destructive text-sm">{error}</p>;
  if (!contents) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Lecture des fichiers…
      </p>
    );
  }

  const labelOf = (packId: string) => c.sides.find((s) => s.packId === packId)?.label ?? "?";

  return (
    <div className="rounded-md border">
      <div className="bg-muted/40 flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
        <span>
          De la version du pack <strong>{ref.label}</strong> à celle du pack
        </span>
        {c.sides.length > 2 ? (
          <select
            aria-label="Version à comparer"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            className="bg-background rounded border px-1.5 py-0.5"
          >
            {c.sides.slice(1).map((s) => (
              <option key={s.packId} value={s.packId}>
                {s.label}
              </option>
            ))}
          </select>
        ) : (
          <strong>{labelOf(other)}</strong>
        )}
        {result?.kind === "diff" && (
          <span className="text-muted-foreground ml-auto">
            {result.removed} ligne{result.removed > 1 ? "s" : ""} retirée
            {result.removed > 1 ? "s" : ""}, {result.added} ajoutée{result.added > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {!result ? (
        <p className="text-muted-foreground p-3 text-sm">
          Aperçu indisponible : fichier binaire ou trop volumineux.
        </p>
      ) : result.kind === "identical" ? (
        <p className="text-muted-foreground p-3 text-sm">
          Contenu identique, aux fins de ligne près.
        </p>
      ) : result.kind === "tooLarge" ? (
        <p className="text-muted-foreground p-3 text-sm">
          Trop de différences pour un aperçu lisible.
        </p>
      ) : (
        <div className="max-h-96 overflow-auto font-mono text-xs">
          {result.hunks.map((h, k) => (
            <table key={k} className="w-full border-collapse [&+&]:border-t [&+&]:border-dashed">
              <tbody>
                {h.lines.map((l, i) => (
                  <tr
                    key={i}
                    className={cn(
                      l.type === "del" && "bg-destructive/10",
                      l.type === "add" && "bg-success/10",
                    )}
                  >
                    <td className="text-muted-foreground w-10 px-2 text-right align-top select-none">
                      {l.type === "add" ? l.b : l.a}
                    </td>
                    <td className="w-5 px-1 align-top font-semibold select-none" aria-hidden>
                      {l.type === "del" ? "−" : l.type === "add" ? "+" : ""}
                    </td>
                    <td className="px-1 pr-3 break-all whitespace-pre-wrap">
                      {l.type === "del" && <span className="sr-only">Retiré : </span>}
                      {l.type === "add" && <span className="sr-only">Ajouté : </span>}
                      {l.text || " "}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      )}
    </div>
  );
}
