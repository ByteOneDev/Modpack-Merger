"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight, CircleCheck, CircleHelp, CircleX, Copy, Layers, Search, Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StepGuard } from "@/components/empty-state";
import { PinnedConflicts } from "@/components/pinned-conflicts";
import { FileConflictCard, fileConflictStatus } from "@/components/conflicts/file-conflict-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMerge } from "@/lib/store";
import {
  alignPinnedVersion, excludeMod, preferDuplicate, resolveConflict,
} from "@/lib/actions";
import { cn } from "@/lib/utils";
import type {
  FunctionalConflict, ModResolution, OverrideConflict, OverrideDecision, ParsedPack,
} from "@/lib/core/types";

/**
 * Centre de conflits : tout ce qui demande un arbitrage, au meme endroit,
 * range par gravite.
 *
 * - Bloquant : le jeu plantera tant que ce n'est pas regle.
 * - A decider : l'outil n'a pas de reponse sure et demande.
 * - Regle automatiquement : l'outil a tranche (version la plus recente,
 *   fusion), et le montre, pour qu'on puisse changer d'avis.
 */
export default function ConflictsPage() {
  const router = useRouter();
  const { state, setState, settings, hydrated } = useMerge();
  const [showSettled, setShowSettled] = React.useState(false);

  if (!hydrated) return null;
  if (!state.analyzed || !state.target) {
    return (
      <StepGuard
        title="Fusion pas encore calculee"
        description="Les conflits sont detectes pendant la fusion."
        href="/cible/"
        cta="Configurer la cible"
      />
    );
  }

  const hard = state.conflicts.filter((c) => c.severity === "hard");
  const soft = state.conflicts.filter((c) => c.severity !== "hard");
  const files = state.overrideConflicts;
  const status = (c: OverrideConflict) => fileConflictStatus(c, state.decisions[c.path]);
  const pendingFiles = files.filter((c) => status(c) === "pending");
  const settledFiles = files.filter((c) => status(c) !== "pending");
  const duplicates = state.resolutions.filter(
    (r) => r.status === "duplicate" && r.duplicateOf && r.beforeExclusion?.picked,
  );

  const blocking = state.pinnedConflicts.length + hard.length;
  const toDecide = soft.length + pendingFiles.length;
  const settled = duplicates.length + settledFiles.length;

  const decide = (path: string, d: OverrideDecision) =>
    setState((prev) => ({ ...prev, decisions: { ...prev.decisions, [path]: d } }));

  const acceptAll = () =>
    setState((prev) => {
      const decisions = { ...prev.decisions };
      for (const c of prev.overrideConflicts) {
        if (!(c.path in decisions)) decisions[c.path] = c.suggestion;
      }
      return { ...prev, decisions };
    });

  const keep = (keepKey: string, c: FunctionalConflict) =>
    setState((prev) => ({
      ...prev,
      ...resolveConflict(prev, keepKey, c.members.map((m) => m.key), settings),
    }));

  return (
    <>
      <PageHeader
        title="Conflits"
        description="Tout ce qui demande un arbitrage avant l'export, du plus grave au plus anodin. Par défaut, la version la plus récente l'emporte."
        action={
          <Button onClick={() => router.push("/export/")}>
            Continuer <ArrowRight />
          </Button>
        }
      />

      <nav aria-label="Résumé des conflits" className="mb-6 grid gap-3 sm:grid-cols-3">
        <SummaryTile
          href="#bloquant"
          icon={CircleX}
          tone={blocking ? "danger" : "muted"}
          value={blocking}
          label="Bloquant"
          hint="le jeu plantera"
        />
        <SummaryTile
          href="#a-decider"
          icon={CircleHelp}
          tone={toDecide ? "warning" : "muted"}
          value={toDecide}
          label="À décider"
          hint="l'outil ne peut pas trancher seul"
        />
        <SummaryTile
          href="#regle"
          icon={Sparkles}
          tone="info"
          value={settled}
          label="Réglé automatiquement"
          hint="modifiable à tout moment"
          onClick={() => setShowSettled(true)}
        />
      </nav>

      {blocking + toDecide === 0 && (
        <Alert variant="success" className="mb-6">
          <CircleCheck />
          <AlertTitle>Plus rien à décider</AlertTitle>
          <AlertDescription>
            {settled
              ? `${settled} conflit${settled > 1 ? "s ont" : " a"} été réglé${settled > 1 ? "s" : ""} automatiquement — tu peux les revoir plus bas.`
              : "Tes packs ne se marchent pas dessus."}
          </AlertDescription>
        </Alert>
      )}

      {blocking > 0 && (
        <Section
          id="bloquant"
          icon={CircleX}
          tone="danger"
          title="Bloquant"
          count={blocking}
          description="Tant que ces conflits existent, le pack s'installe normalement puis plante au démarrage ou au chargement du monde."
        >
          <PinnedConflicts
            conflicts={state.pinnedConflicts}
            resolutions={state.resolutions}
            onAlign={async (c) => {
              const patch = await alignPinnedVersion(state, c, settings);
              if (!patch.error) setState((prev) => ({ ...prev, ...patch }));
              return patch;
            }}
            onDropDependent={(key) =>
              setState((prev) => ({ ...prev, ...excludeMod(prev, key, settings) }))
            }
          />
          {hard.map((c) => (
            <FunctionalConflictCard key={c.groupId} conflict={c} onKeep={(k) => keep(k, c)} />
          ))}
        </Section>
      )}

      {toDecide > 0 && (
        <Section
          id="a-decider"
          icon={CircleHelp}
          tone="warning"
          title="À décider"
          count={toDecide}
          description="Rien ne permet de dire quelle version est la plus récente, ou deux mods différents font la même chose. Une suggestion est pré-sélectionnée : il suffit de la valider."
          action={
            pendingFiles.length > 1 ? (
              <Button size="sm" onClick={acceptAll}>
                <CircleCheck /> Valider les {pendingFiles.length} suggestions de fichiers
              </Button>
            ) : undefined
          }
        >
          {soft.map((c) => (
            <FunctionalConflictCard key={c.groupId} conflict={c} onKeep={(k) => keep(k, c)} />
          ))}
          <FileList
            conflicts={pendingFiles}
            decisions={state.decisions}
            packs={state.packs}
            onDecide={decide}
          />
        </Section>
      )}

      {settled > 0 && (
        <Section
          id="regle"
          icon={Sparkles}
          tone="info"
          title="Réglé automatiquement"
          count={settled}
          description="Doublons écartés au profit de la version la plus récente, et fichiers tranchés sans ambiguïté. Tout reste modifiable."
          action={
            <Button
              size="sm"
              variant="outline"
              aria-expanded={showSettled}
              aria-controls="regle-contenu"
              onClick={() => setShowSettled((v) => !v)}
            >
              {showSettled ? "Masquer" : `Afficher les ${settled}`}
            </Button>
          }
        >
          {showSettled && (
            <div id="regle-contenu" className="space-y-4">
              {duplicates.length > 0 && (
                <DuplicateList
                  duplicates={duplicates}
                  resolutions={state.resolutions}
                  packs={state.packs}
                  onPrefer={(key) =>
                    setState((prev) => ({ ...prev, ...preferDuplicate(prev, key, settings) }))
                  }
                />
              )}
              <FileList
                conflicts={settledFiles}
                decisions={state.decisions}
                packs={state.packs}
                onDecide={decide}
              />
            </div>
          )}
        </Section>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={() => router.push("/export/")}>
          Continuer vers l&apos;export <ArrowRight />
        </Button>
        <Button variant="outline" onClick={() => router.push("/mods/")}>
          Retour aux mods
        </Button>
      </div>
    </>
  );
}

const TONE = {
  danger: "text-destructive",
  warning: "text-warning-foreground dark:text-warning",
  info: "text-info",
  muted: "text-muted-foreground",
} as const;

function SummaryTile({
  href,
  icon: Icon,
  tone,
  value,
  label,
  hint,
  onClick,
}: {
  href: string;
  icon: React.ElementType;
  tone: keyof typeof TONE;
  value: number;
  label: string;
  hint: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <Icon className={cn("size-5 shrink-0", TONE[tone])} aria-hidden />
      <span>
        <span className="block text-2xl leading-none font-semibold">{value}</span>
        <span className="mt-1 block text-sm font-medium">{label}</span>
        <span className="text-muted-foreground block text-xs">{hint}</span>
      </span>
    </>
  );
  const cls = "flex items-start gap-3 rounded-lg border p-3";
  if (!value) return <div className={cn(cls, "opacity-70")}>{inner}</div>;
  return (
    <a
      href={href}
      onClick={onClick}
      className={cn(cls, "hover:bg-muted/50 focus-visible:ring-ring transition-colors focus-visible:ring-2 focus-visible:outline-none")}
    >
      {inner}
    </a>
  );
}

function Section({
  id,
  icon: Icon,
  tone,
  title,
  count,
  description,
  action,
  children,
}: {
  id: string;
  icon: React.ElementType;
  tone: keyof typeof TONE;
  title: string;
  count: number;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="mb-8 scroll-mt-32">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h2 id={`${id}-titre`} className="flex items-center gap-2 text-lg font-semibold">
            <Icon className={cn("size-5", TONE[tone])} aria-hidden />
            {title}
            <Badge variant="outline">{count}</Badge>
          </h2>
          <p className="text-muted-foreground mt-1 text-sm text-pretty">{description}</p>
        </div>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function FunctionalConflictCard({
  conflict: c,
  onKeep,
}: {
  conflict: FunctionalConflict;
  onKeep: (key: string) => void;
}) {
  return (
    <article className={cn("rounded-lg border p-4", c.severity === "hard" && "border-destructive/40")}>
      <h3 className="flex flex-wrap items-center gap-2 font-medium">
        <Layers className="text-muted-foreground size-4" aria-hidden />
        {c.groupLabel}
        <Badge variant={c.severity === "hard" ? "destructive" : "warning"}>
          {c.severity === "hard" ? "fait planter le jeu" : "redondant"}
        </Badge>
      </h3>
      <p className="text-muted-foreground mt-1 text-sm text-pretty">{c.explanation}</p>
      <p className="mt-3 text-sm font-medium">Lequel garder ? Les autres seront écartés.</p>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {c.members.map((m) => (
          <li key={m.key} className="flex items-center justify-between gap-3 rounded-md border p-3">
            <span className="min-w-0 text-sm">
              <span className="font-medium">{m.name}</span>
              {m.recommended && (
                <Badge variant="success" className="ml-2">
                  recommandé
                </Badge>
              )}
            </span>
            <Button size="sm" variant={m.recommended ? "default" : "outline"} onClick={() => onKeep(m.key)}>
              Garder <span className="sr-only">{m.name}</span>
            </Button>
          </li>
        ))}
      </ul>
    </article>
  );
}

function originLabel(r: ModResolution, packs: ParsedPack[]): string {
  if (r.from.kind === "dependency") return "dépendance ajoutée";
  if (r.from.kind === "manual") return "ajout manuel";
  const from = r.from;
  const p = packs.find((x) => x.id === from.packId);
  return p ? `pack ${p.label}` : "pack";
}

const PROVIDER: Record<string, string> = { modrinth: "Modrinth", curseforge: "CurseForge" };

function DuplicateList({
  duplicates,
  resolutions,
  packs,
  onPrefer,
}: {
  duplicates: ModResolution[];
  resolutions: ModResolution[];
  packs: ParsedPack[];
  onPrefer: (key: string) => void;
}) {
  return (
    <div className="rounded-lg border">
      <h3 className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
        <Copy className="text-muted-foreground size-4" aria-hidden />
        Mods présents en double
        <Badge variant="outline">{duplicates.length}</Badge>
      </h3>
      <ul className="divide-y">
        {duplicates.map((d) => {
          const w = resolutions.find((r) => r.key === d.duplicateOf);
          const mine = d.beforeExclusion!.picked!;
          return (
            <li key={d.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 text-sm">
                <p>
                  <strong>{w?.name ?? d.name}</strong> est gardé en{" "}
                  <span className="font-mono text-xs">{w?.picked?.versionNumber ?? "?"}</span>
                  {w?.picked && (
                    <span className="text-muted-foreground">
                      {" "}({originLabel(w, packs)}, {PROVIDER[w.picked.provider]})
                    </span>
                  )}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Écarté : <span className="font-mono">{mine.versionNumber}</span> ({originLabel(d, packs)},{" "}
                  {PROVIDER[mine.provider]}) — {w?.keptByUser ? "ton choix" : "version plus ancienne"}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => onPrefer(d.key)}>
                Garder plutôt <span className="font-mono text-xs">{mine.versionNumber}</span>
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const PAGE = 20;

/** Liste filtrable et paginee : un pack peut compter des centaines de conflits. */
function FileList({
  conflicts,
  decisions,
  packs,
  onDecide,
}: {
  conflicts: OverrideConflict[];
  decisions: Record<string, OverrideDecision>;
  packs: ParsedPack[];
  onDecide: (path: string, d: OverrideDecision) => void;
}) {
  const [filter, setFilter] = React.useState("");
  const [limit, setLimit] = React.useState(PAGE);
  if (!conflicts.length) return null;

  const q = filter.trim().toLowerCase();
  const shown = q ? conflicts.filter((c) => c.path.toLowerCase().includes(q)) : conflicts;

  return (
    <div className="space-y-3">
      {conflicts.length > 5 && (
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden />
          <Input
            type="search"
            aria-label="Filtrer les fichiers par chemin"
            placeholder={`Filtrer les ${conflicts.length} fichiers par chemin…`}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setLimit(PAGE);
            }}
            className="pl-9"
          />
        </div>
      )}

      {shown.slice(0, limit).map((c) => (
        <FileConflictCard
          key={c.path}
          conflict={c}
          decision={decisions[c.path]}
          packs={packs}
          onDecide={(d) => onDecide(c.path, d)}
        />
      ))}

      {!shown.length && (
        <p className="text-muted-foreground py-4 text-center text-sm">
          Aucun fichier ne correspond à ce filtre.
        </p>
      )}
      {shown.length > limit && (
        <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
          Afficher {Math.min(PAGE, shown.length - limit)} fichiers de plus ({shown.length - limit} restants)
        </Button>
      )}
    </div>
  );
}
