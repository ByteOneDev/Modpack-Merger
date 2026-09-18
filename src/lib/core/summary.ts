import { CONTENT_INFO, CONTENT_KINDS, type ContentKind } from "./content";
import type { EnvSupport, ModResolution } from "./types";

/**
 * Recapitulatif du contenu retenu.
 *
 * Deux questions reviennent avant d'installer un pack : qu'est-ce qu'il y a
 * dedans exactement, et qu'est-ce qui doit aller sur le serveur. Les mods
 * declarent leur cote dans les metadonnees des deux plateformes, et le type
 * de contenu tranche le reste : un shader ne tourne jamais sur un serveur.
 */

export type Side = "client" | "server" | "both";

export interface SummaryItem {
  key: string;
  name: string;
  kind: ContentKind;
  side: Side;
  versionNumber: string;
  provider: string;
  fileSize: number;
  url?: string;
  unstable: boolean;
  /** source : pack d'origine, dependance, ou ajout manuel */
  origin: "pack" | "dependency" | "manual";
  /** ce que cet element exige pour fonctionner */
  requires: string[];
  /** ce qui exige cet element */
  requiredBy: string[];
  /** l'auteur interdit la distribution : fichier a recuperer a la main */
  manualOnly: boolean;
  /** une version plus recente existe mais n'est pas stable */
  newerAvailable?: string;
}

export interface KindGroup {
  kind: ContentKind;
  label: string;
  hint: string;
  items: SummaryItem[];
  bytes: number;
}

export interface PackSummary {
  groups: KindGroup[];
  clientOnly: SummaryItem[];
  serverOnly: SummaryItem[];
  shared: SummaryItem[];
  /** elements qui n'existent que parce qu'un autre les exige */
  dependencies: SummaryItem[];
  manualOnly: SummaryItem[];
  totalItems: number;
  totalBytes: number;
  /** taille totale de ce qui part sur un serveur dedie */
  serverBytes: number;
}

/**
 * Cote d'un element.
 *
 * Le type de contenu prime quand il est categorique : un resource pack reste
 * client meme si une plateforme le declare mal. Sinon on lit les champs
 * client_side / server_side, qui sont la source la plus fiable.
 */
export function sideOf(r: ModResolution): Side {
  const declared = CONTENT_INFO[r.kind].side;
  if (declared !== "both") return declared;

  const client = r.project?.clientSide ?? r.source?.env.client ?? "unknown";
  const server = r.project?.serverSide ?? r.source?.env.server ?? "unknown";

  const usable = (v: EnvSupport) => v === "required" || v === "optional";
  if (usable(client) && server === "unsupported") return "client";
  if (usable(server) && client === "unsupported") return "server";
  return "both";
}

function originOf(r: ModResolution): SummaryItem["origin"] {
  return r.from.kind === "dependency" ? "dependency" : r.from.kind === "manual" ? "manual" : "pack";
}

export function buildSummary(resolutions: ModResolution[]): PackSummary {
  const kept = resolutions.filter(
    (r) => (r.status === "ok" || r.status === "substituted") && r.picked,
  );

  // Index projet -> nom, pour traduire les dependances en quelque chose de
  // lisible plutot qu'en identifiants numeriques.
  const nameByProject = new Map<string, string>();
  for (const r of kept) {
    nameByProject.set(`${r.picked!.provider}:${r.picked!.projectId}`, r.name);
  }

  const requiredBy = new Map<string, string[]>();
  for (const r of kept) {
    for (const d of r.picked!.dependencies) {
      if (d.type !== "required" || !d.projectId) continue;
      const id = `${d.provider}:${d.projectId}`;
      if (!nameByProject.has(id)) continue;
      const list = requiredBy.get(id) ?? [];
      list.push(r.name);
      requiredBy.set(id, list);
    }
  }

  const items: SummaryItem[] = kept.map((r) => {
    const v = r.picked!;
    const id = `${v.provider}:${v.projectId}`;
    return {
      key: r.key,
      name: r.name,
      kind: r.kind,
      side: sideOf(r),
      versionNumber: v.local ? "" : v.versionNumber,
      // Un fichier depose par l'utilisateur ne vient d'aucune plateforme :
      // afficher "modrinth" serait faux.
      provider: v.local ? "fichier local" : v.provider,
      fileSize: v.fileSize ?? 0,
      url: r.project?.url,
      unstable: r.unstable ?? false,
      origin: originOf(r),
      requires: v.dependencies
        .filter((d) => d.type === "required" && d.projectId)
        .map((d) => nameByProject.get(`${d.provider}:${d.projectId}`))
        .filter((n): n is string => !!n),
      requiredBy: requiredBy.get(id) ?? [],
      manualOnly: v.manualOnly === true,
      newerAvailable: r.newerAvailable
        ? `${r.newerAvailable.versionNumber} (${r.newerAvailable.versionType})`
        : undefined,
    };
  });

  const groups: KindGroup[] = CONTENT_KINDS.map((kind) => {
    const list = items.filter((i) => i.kind === kind);
    return {
      kind,
      label: CONTENT_INFO[kind].plural,
      hint: CONTENT_INFO[kind].hint,
      items: list.sort((a, b) => a.name.localeCompare(b.name, "fr")),
      bytes: list.reduce((n, i) => n + i.fileSize, 0),
    };
  }).filter((g) => g.items.length > 0);

  const clientOnly = items.filter((i) => i.side === "client");
  const serverOnly = items.filter((i) => i.side === "server");
  const shared = items.filter((i) => i.side === "both");

  return {
    groups,
    clientOnly,
    serverOnly,
    shared,
    dependencies: items.filter((i) => i.origin === "dependency"),
    manualOnly: items.filter((i) => i.manualOnly),
    totalItems: items.length,
    totalBytes: items.reduce((n, i) => n + i.fileSize, 0),
    serverBytes: [...serverOnly, ...shared].reduce((n, i) => n + i.fileSize, 0),
  };
}
