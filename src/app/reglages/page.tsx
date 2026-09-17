"use client";

import * as React from "react";
import Link from "next/link";
import {
  CircleCheck, Database, Eraser, Info, Loader2, Monitor, Moon,
  Palette, Plug, Sun, TriangleAlert, Wrench,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useMerge } from "@/lib/store";
import { curseforge } from "@/lib/core/providers/curseforge";
import { archivesFootprint } from "@/lib/archives";
import { humanSize } from "@/lib/format";

export default function SettingsPage() {
  const { settings, updateSettings, reset, state, hydrated, relay } = useMerge();
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [footprint, setFootprint] = React.useState<number | null>(null);
  const [cleared, setCleared] = React.useState(false);

  React.useEffect(() => {
    archivesFootprint().then(setFootprint).catch(() => setFootprint(null));
  }, [state.packs.length, cleared]);

  if (!hydrated) return null;

  return (
    <>
      <PageHeader
        title="Parametres"
        description="Tout est stocke dans ce navigateur. Rien n'est envoye ailleurs."
        action={
          <Button variant="outline" asChild>
            <Link href="/">Retour a la fusion</Link>
          </Button>
        }
      />

      {/* ---------------- Apparence ---------------- */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="size-4" /> Apparence
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <Label>Theme</Label>
              <p className="text-muted-foreground mt-0.5 text-xs">
                « Systeme » suit le reglage de ton ordinateur.
              </p>
            </div>
            <ToggleGroup
              type="single"
              value={settings.theme}
              onValueChange={(v) => v && updateSettings({ theme: v as typeof settings.theme })}
            >
              <ToggleGroupItem value="light">
                <Sun /> Clair
              </ToggleGroupItem>
              <ToggleGroupItem value="dark">
                <Moon /> Sombre
              </ToggleGroupItem>
              <ToggleGroupItem value="system">
                <Monitor /> Systeme
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </CardContent>
      </Card>

      {/* ---------------- Sources ---------------- */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="size-4" /> Sources de mods
          </CardTitle>
          <CardDescription>
            Modrinth fonctionne sans configuration. CurseForge demande un relais.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <div className="flex items-center gap-2 font-medium">
                Modrinth <Badge variant="success">actif</Badge>
              </div>
              <p className="text-muted-foreground mt-0.5 text-xs">
                API publique, interrogeable directement depuis le navigateur.
              </p>
            </div>
            <CircleCheck className="text-success size-5 shrink-0" />
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center gap-2 font-medium">
              CurseForge
              {relay === null ? (
                <Badge variant="secondary">detection…</Badge>
              ) : relay.kind === "ready" && !settings.curseforgeProxyUrl ? (
                <Badge variant="success">relais integre actif</Badge>
              ) : curseforge.available() ? (
                <Badge variant="success">relais externe configure</Badge>
              ) : (
                <Badge variant="secondary">inactif</Badge>
              )}
            </div>

            {relay?.kind === "ready" && !settings.curseforgeProxyUrl && (
              <Alert variant="success">
                <CircleCheck />
                <AlertTitle>Rien a faire</AlertTitle>
                <AlertDescription>
                  Ton hebergement execute le relais fourni avec le projet. CurseForge est
                  accessible et les jars se telechargent aussi a travers lui, ce qui evite les
                  blocages de certains CDN.
                </AlertDescription>
              </Alert>
            )}

            {relay?.kind === "unconfigured" && (
              <Alert variant="warning">
                <TriangleAlert />
                <AlertTitle>Relais present mais sans cle</AlertTitle>
                <AlertDescription>
                  {relay.message} Recharge la page une fois la variable ajoutee.
                </AlertDescription>
              </Alert>
            )}

            {relay?.kind === "none" && (
              <Alert variant="info">
                <Info />
                <AlertTitle>Pourquoi un relais est necessaire</AlertTitle>
                <AlertDescription>
                  L&apos;API CurseForge exige une cle secrete et refuse les appels venant
                  d&apos;une page web. Un site purement statique ne peut pas garder de secret :
                  une cle placee ici serait lisible par tout le monde.
                  <br />
                  Deux solutions : heberger l&apos;app sur une plateforme qui execute le dossier{" "}
                  <code className="font-mono text-xs">functions/</code> du depot (Cloudflare
                  Pages, Netlify, Vercel — le relais devient automatique), ou deployer le
                  Worker fourni dans{" "}
                  <code className="font-mono text-xs">proxy/curseforge-worker.js</code> et coller
                  son URL ci-dessous.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="proxy">URL d&apos;un relais externe</Label>
              <Input
                id="proxy"
                value={settings.curseforgeProxyUrl}
                onChange={(e) => updateSettings({ curseforgeProxyUrl: e.target.value })}
                placeholder={
                  relay?.kind === "ready"
                    ? "laisse vide : le relais integre est utilise"
                    : "https://mon-relais.workers.dev"
                }
              />
              <p className="text-muted-foreground text-xs">
                {relay?.kind === "ready"
                  ? "A ne remplir que pour forcer un autre relais que celui de l'hebergement."
                  : "Sans relais, les mods publies uniquement sur CurseForge seront comptes comme introuvables."}
              </p>
            </div>

            {settings.curseforgeProxyUrl && (
              <div className="space-y-2">
                <Label htmlFor="cfkey">Cle API (deconseille)</Label>
                <Input
                  id="cfkey"
                  type="password"
                  value={settings.curseforgeApiKey}
                  onChange={(e) => updateSettings({ curseforgeApiKey: e.target.value })}
                  placeholder="seulement si ton relais attend que le client la fournisse"
                />
                <p className="text-muted-foreground text-xs">
                  A laisser vide dans presque tous les cas. Une cle saisie ici est stockee en
                  clair dans ce navigateur et envoyee a chaque requete : c&apos;est au relais de
                  la detenir, pas au client.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={!settings.curseforgeProxyUrl || testing}
                onClick={async () => {
                  setTesting(true);
                  setTestResult(null);
                  try {
                    setTestResult(await curseforge.testConnection());
                  } finally {
                    setTesting(false);
                  }
                }}
              >
                {testing ? <Loader2 className="animate-spin" /> : <Plug />}
                Tester la connexion
              </Button>
              {testResult && (
                <span
                  className={`text-xs ${testResult.ok ? "text-success" : "text-destructive"}`}
                >
                  {testResult.message}
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---------------- Comportement ---------------- */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="size-4" /> Comportement de la fusion
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <Toggle
            label="Preferer les versions stables"
            hint="Une release recente l'emporte sur une beta plus recente. Desactive-le pour toujours prendre la derniere version publiee, quelle qu'elle soit."
            checked={settings.preferStable}
            onChange={(v) => updateSettings({ preferStable: v })}
          />
          <Separator />
          <Toggle
            label="Ajouter les dependances automatiquement"
            hint="Les bibliotheques requises manquantes sont ajoutees dans la bonne version, en remontant toute la chaine."
            checked={settings.autoDependencies}
            onChange={(v) => updateSettings({ autoDependencies: v })}
          />
          <Separator />
          <Toggle
            label="Detecter les doublons fonctionnels"
            hint="Signale les mods differents qui font la meme chose : deux visualiseurs de recettes, deux moteurs de rendu, trois minimaps."
            checked={settings.detectFunctionalConflicts}
            onChange={(v) => updateSettings({ detectFunctionalConflicts: v })}
          />

          <Separator />

          <div className="flex flex-wrap items-center justify-between gap-4 py-3">
            <div className="max-w-md">
              <Label>Telechargements simultanes</Label>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Pour l&apos;export en pack complet. Au-dela de 8, certaines plateformes limitent
                le debit.
              </p>
            </div>
            <Select
              value={String(settings.downloadConcurrency)}
              onValueChange={(v) => updateSettings({ downloadConcurrency: Number(v) })}
            >
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 5, 8, 12].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ---------------- Export ---------------- */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Valeurs par defaut a l&apos;export</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Format</Label>
            <Select
              value={settings.defaultExportFormat}
              onValueChange={(v) =>
                updateSettings({ defaultExportFormat: v as "mrpack" | "curseforge" })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mrpack">.mrpack (Modrinth)</SelectItem>
                <SelectItem value="curseforge">.zip CurseForge</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Contenu</Label>
            <Select
              value={settings.defaultBundleJars ? "bundle" : "manifest"}
              onValueChange={(v) => updateSettings({ defaultBundleJars: v === "bundle" })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bundle">Pack complet (jars inclus)</SelectItem>
                <SelectItem value="manifest">Manifeste seul</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ---------------- Donnees ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-4" /> Donnees locales
          </CardTitle>
          <CardDescription>
            Les archives que tu envoies sont gardees dans ce navigateur pour qu&apos;un
            rechargement de page ne fasse pas perdre ton travail.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">
              {state.packs.length} pack{state.packs.length > 1 ? "s" : ""} en cours
            </Badge>
            <Badge variant="outline">
              {footprint === null ? "…" : humanSize(footprint)} occupes
            </Badge>
          </div>

          {cleared && (
            <Alert variant="success">
              <CircleCheck />
              <AlertDescription>Tout a ete efface.</AlertDescription>
            </Alert>
          )}

          <Alert variant="warning">
            <TriangleAlert />
            <AlertDescription>
              Effacer supprime les archives chargees et l&apos;avancement de la fusion. Les
              parametres ci-dessus sont conserves.
            </AlertDescription>
          </Alert>

          <Button
            variant="destructive"
            onClick={async () => {
              await reset();
              setCleared(true);
              setTimeout(() => setCleared(false), 3000);
            }}
          >
            <Eraser /> Effacer les donnees de session
          </Button>
        </CardContent>
      </Card>
    </>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="max-w-2xl">
        <Label>{label}</Label>
        <p className="text-muted-foreground mt-0.5 text-xs text-pretty">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-1 shrink-0" />
    </div>
  );
}
