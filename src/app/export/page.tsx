"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CircleCheck, Download, FileDown, ListTree, Loader2, Package, TriangleAlert,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StepGuard } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { PackSummaryView } from "@/components/pack-summary";
import { ManualDownloads } from "@/components/manual-downloads";
import { useMerge } from "@/lib/store";
import { readPackFiles } from "@/lib/analyze";
import { buildPack, type BuildReport, type ExportFormat } from "@/lib/core/build";
import { buildSummary } from "@/lib/core/summary";
import { countLabel } from "@/lib/core/content";
import { loadManualFiles, pendingDownloads } from "@/lib/manual";
import { askWhereToSave, canStreamToDisk, downloadBlob } from "@/lib/save";
import { humanSize } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function ExportPage() {
  const router = useRouter();
  const { state, setState, settings, hydrated } = useMerge();

  const [format, setFormat] = React.useState<ExportFormat>(settings.defaultExportFormat);
  const [bundleJars, setBundleJars] = React.useState(settings.defaultBundleJars);
  const [progress, setProgress] = React.useState<{ step: string; done: number; total: number } | null>(null);
  const [report, setReport] = React.useState<BuildReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [showSummary, setShowSummary] = React.useState(false);
  const [savedTo, setSavedTo] = React.useState<string | null>(null);

  if (!hydrated) return null;
  if (!state.analyzed || !state.target) {
    return (
      <StepGuard
        title="Rien a exporter"
        description="Lance d'abord la fusion pour generer un pack."
        href="/cible/"
        cta="Configurer la cible"
      />
    );
  }

  const target = state.target;
  const kept = state.resolutions.filter(
    (r) => r.status === "ok" || r.status === "substituted",
  );
  const summary = buildSummary(state.resolutions);
  const pending = pendingDownloads(
    state.resolutions,
    state.manualFiles,
    new Set(state.failedDownloads),
  );

  async function run() {
    setError(null);
    setReport(null);
    setProgress({ step: "Preparation", done: 0, total: 1 });
    try {
      const packFiles = await readPackFiles(state.packs);
      const manualFiles = await loadManualFiles(Object.keys(state.manualFiles));

      // Nom propose avant generation : le choix du fichier doit suivre le
      // clic de l'utilisateur, sinon le navigateur refuse d'ouvrir la fenetre.
      const suggested = suggestedFileName(target, format);
      const destination = bundleJars && canStreamToDisk() ? await askWhereToSave(suggested) : null;

      const built = await buildPack({
        target,
        resolutions: state.resolutions,
        packFiles,
        decisions: state.decisions,
        format,
        bundleJars,
        concurrency: settings.downloadConcurrency,
        ram: state.ram ?? undefined,
        manualFiles,
        sink: destination?.sink,
        onProgress: (step, done, total) => setProgress({ step, done, total }),
      });

      // Sans destination disque, l'archive revient en Blob : le navigateur la
      // garde hors du tas JavaScript, ce qui permet deja de depasser le Go.
      if (built.blob) downloadBlob(built.blob, built.report.fileName);
      setSavedTo(destination ? destination.name : null);

      setReport(built.report);
      // Les echecs alimentent la liste des telechargements manuels : un CDN
      // qui refuse la requete pose le meme probleme qu'un refus de l'auteur.
      setState((prev) => ({
        ...prev,
        failedDownloads: built.report.modsFailed.map((f) => f.key),
      }));
    } catch (err) {
      setSavedTo(null);
      const message = err instanceof Error ? err.message : String(err);
      setError(
        /allocation failed|out of memory|Array buffer/i.test(message)
          ? "Memoire insuffisante pour assembler l'archive. Passe en « manifeste seul », " +
            "ou reduis le nombre de telechargements simultanes dans les reglages."
          : message || "La generation a echoue.",
      );
    } finally {
      setProgress(null);
    }
  }

  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Exporter le pack fusionne"
        description={`${summary.totalItems} elements · ${target.loader} ${target.minecraft} · l'archive contient un RAPPORT-DE-FUSION.md detaillant ce qui a ete garde, remplace et abandonne, ainsi que la RAM recommandee.`}
        action={
          <Button variant={showSummary ? "secondary" : "outline"} onClick={() => setShowSummary((v) => !v)}>
            <ListTree />
            {showSummary ? "Masquer le recapitulatif" : "Voir le recapitulatif"}
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {summary.groups.map((g) => (
          <Badge key={g.kind} variant="secondary">
            {countLabel(g.kind, g.items.length)}
          </Badge>
        ))}
        <Badge variant="outline">{summary.clientOnly.length} client seul</Badge>
        <Badge variant="outline">{summary.serverOnly.length} serveur seul</Badge>
      </div>

      {showSummary && (
        <div className="mb-6">
          <PackSummaryView summary={summary} />
        </div>
      )}

      {(pending.length > 0 || Object.keys(state.manualFiles).length > 0) && (
        <div className="mb-6">
          <ManualDownloads
            pending={pending}
            have={state.manualFiles}
            onChange={(next) => setState((prev) => ({ ...prev, manualFiles: next }))}
          />
        </div>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Format</CardTitle>
          <CardDescription>Selon le lanceur que tu utilises.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Choice
            selected={format === "mrpack"}
            onClick={() => setFormat("mrpack")}
            title=".mrpack"
            subtitle="Modrinth App, Prism, ATLauncher, MultiMC"
          />
          <Choice
            selected={format === "curseforge"}
            onClick={() => setFormat("curseforge")}
            title=".zip CurseForge"
            subtitle="CurseForge App, hebergeurs de serveurs"
          />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Contenu de l&apos;archive</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Choice
            selected={bundleJars}
            onClick={() => setBundleJars(true)}
            title="Pack complet"
            subtitle="les .jar sont telecharges et inclus — s'installe partout, archive lourde"
            icon={<Package className="size-4" />}
          />
          <Choice
            selected={!bundleJars}
            onClick={() => setBundleJars(false)}
            title="Manifeste seul"
            subtitle="quelques Ko, le lanceur telecharge les mods lui-meme"
            icon={<FileDown className="size-4" />}
          />
        </CardContent>
      </Card>

      {!bundleJars && format === "mrpack" && (
        <Alert variant="info" className="mb-6">
          <TriangleAlert />
          <AlertTitle>Les mods hors Modrinth seront quand meme embarques</AlertTitle>
          <AlertDescription>
            Un index <code className="font-mono text-xs">.mrpack</code> n&apos;accepte que des
            liens Modrinth, GitHub ou GitLab. Les autres iront dans{" "}
            <code className="font-mono text-xs">overrides/mods/</code>.
          </AlertDescription>
        </Alert>
      )}

      {bundleJars && (
        <Alert variant="info" className="mb-6">
          <TriangleAlert />
          <AlertTitle>Le telechargement se fait depuis ton navigateur</AlertTitle>
          <AlertDescription>
            Certains CDN refusent les requetes venant d&apos;une page web. Les mods concernes
            seront listes dans « Telechargements manuels », a recuperer depuis leur page.{" "}
            {canStreamToDisk()
              ? "L'archive sera ecrite au fil de l'eau dans le fichier que tu choisiras : aucune limite de taille."
              : "Ton navigateur ne permet pas d'ecrire directement sur le disque ; l'archive est assemblee puis telechargee, ce qui peut echouer au-dela de 2 Go. Chrome, Edge et Opera n'ont pas cette limite."}
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" className="mb-6">
          <TriangleAlert />
          <AlertTitle>La generation a echoue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {progress ? (
        <Card className="mb-6">
          <CardContent className="space-y-3 py-6">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="size-4 animate-spin" />
              {progress.step}
              {progress.total > 1 && (
                <span className="text-muted-foreground font-normal">
                  {progress.done} / {progress.total}
                </span>
              )}
            </div>
            <Progress value={pct} />
          </CardContent>
        </Card>
      ) : (
        <div className="mb-6 flex items-center gap-3">
          <Button size="lg" onClick={() => void run()}>
            <Download /> Generer et telecharger
          </Button>
          <Button variant="outline" onClick={() => router.push("/fichiers/")}>
            Retour
          </Button>
        </div>
      )}

      {report && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CircleCheck className="text-success size-4" />
              Pack genere
            </CardTitle>
            <CardDescription>
              {savedTo
                ? `Ecrit directement dans « ${savedTo} ».`
                : "Le telechargement a demarre. Si rien ne s'est passe, verifie que ton navigateur ne bloque pas les telechargements automatiques."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="font-mono">
                {report.fileName}
              </Badge>
              <Badge variant="outline">{humanSize(report.totalBytes)}</Badge>
              <Badge variant="outline">{report.modsIncluded} elements</Badge>
              {report.modsLinked > 0 && <Badge variant="outline">{report.modsLinked} lies</Badge>}
              {report.modsBundled > 0 && (
                <Badge variant="outline">{report.modsBundled} embarques</Badge>
              )}
              {report.modsFromManual > 0 && (
                <Badge variant="outline">{report.modsFromManual} fournis a la main</Badge>
              )}
              <Badge variant="outline">{report.overridesWritten} fichiers</Badge>
              {report.overrideConflictsResolved > 0 && (
                <Badge variant="outline">
                  {report.overrideConflictsResolved} conflits arbitres
                </Badge>
              )}
            </div>

            {report.warnings.map((w, i) => (
              <Alert variant="warning" key={i}>
                <TriangleAlert />
                <AlertDescription>{w}</AlertDescription>
              </Alert>
            ))}

            {report.modsFailed.length > 0 && (
              <Alert variant="warning">
                <TriangleAlert />
                <AlertTitle>
                  {report.modsFailed.length} jar
                  {report.modsFailed.length > 1 ? "s" : ""} non embarque
                  {report.modsFailed.length > 1 ? "s" : ""}
                </AlertTitle>
                <AlertDescription>
                  <ul className="mt-1 space-y-1">
                    {report.modsFailed.slice(0, 15).map((f) => (
                      <li key={f.key}>
                        <strong>{f.name}</strong> — {f.reason}
                      </li>
                    ))}
                    {report.modsFailed.length > 15 && (
                      <li>…et {report.modsFailed.length - 15} autres, listes dans le rapport.</li>
                    )}
                  </ul>
                  <p className="mt-2">
                    Ils sont desormais listes dans « Telechargements manuels » plus haut :
                    ouvre leur page, recupere le fichier, et relance la generation.
                  </p>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}

/**
 * Nom propose dans la fenetre d'enregistrement. Le builder recalcule le nom
 * definitif ; ici il s'agit seulement de pre-remplir le champ.
 */
function suggestedFileName(target: { name: string; version: string }, format: ExportFormat) {
  const safe =
    target.name
      .replace(/[^a-zA-Z0-9 _.+-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/ /g, "-") || "modpack";
  return `${safe}-${target.version}.${format === "mrpack" ? "mrpack" : "zip"}`;
}

function Choice({
  selected,
  onClick,
  title,
  subtitle,
  icon,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border p-3 text-left transition-colors",
        selected
          ? "border-primary bg-primary/5 ring-primary/20 ring-2"
          : "hover:border-muted-foreground/40",
      )}
    >
      <div className="flex items-center gap-2 font-medium">
        {icon}
        {title}
      </div>
      <p className="text-muted-foreground mt-1 text-xs text-pretty">{subtitle}</p>
    </button>
  );
}
