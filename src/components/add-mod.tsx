"use client";

import * as React from "react";
import { Check, Loader2, Plus, Search, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { searchAll } from "@/lib/core/providers";
import { LOADER_COMPAT, type MergeTarget, type ProviderId, type ProviderProject } from "@/lib/core/types";
import { humanDownloads } from "@/lib/format";

export function AddMod({
  target,
  onAdd,
}: {
  target: MergeTarget;
  onAdd: (provider: ProviderId, projectId: string) => Promise<{ error?: string; addedName?: string; addedDeps?: number }>;
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<ProviderProject[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [adding, setAdding] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  // Recherche differee : l'utilisateur tape vite, les APIs sont limitees.
  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      setSearching(true);
      searchAll(q, LOADER_COMPAT[target.loader], target.minecraft, 20)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(t);
  }, [query, target.loader, target.minecraft]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ajouter un mod</CardTitle>
        <CardDescription>
          Cherche sur Modrinth et CurseForge. Le mod est ajoute dans sa version la plus recente
          compatible avec {target.loader} {target.minecraft}, avec ses dependances.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nom du mod, ex. Create, Waystones, Iris…"
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
                      const r = await onAdd(p.provider, p.projectId);
                      setMessage(
                        r.error
                          ? { ok: false, text: r.error }
                          : {
                              ok: true,
                              text:
                                `${r.addedName} ajoute` +
                                (r.addedDeps ? ` avec ${r.addedDeps} dependance(s).` : "."),
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
            Aucun mod trouve pour {target.loader} {target.minecraft}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
