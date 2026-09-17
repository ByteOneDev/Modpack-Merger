import type { FunctionalConflict, ModResolution } from "../types";
import { CONFLICT_GROUPS } from "./knowledge";
import { normalizeTitle } from "../providers";

/**
 * Detecte les mods qui font doublon sans etre le meme mod.
 *
 * La deduplication classique ne voit pas ces cas : JEI et REI sont deux
 * projets distincts, avec des ids et des hashs differents, mais installer
 * les deux est une erreur. On compare donc chaque mod retenu aux familles
 * declarees dans la base de connaissances.
 */

/**
 * Identifiants a comparer pour un mod retenu.
 *
 * Apres une substitution, seul le remplacant compte : le mod d'origine n'est
 * plus installe. Garder son identite ferait croire a un conflit qui n'existe
 * pas — remplacer Embeddium par Iris ne cree pas deux moteurs de rendu.
 */
function identityKeys(r: ModResolution): string[] {
  const keys = new Set<string>();
  const push = (v?: string) => {
    if (v) keys.add(v.toLowerCase().replace(/[\s_]+/g, "-"));
  };

  push(r.project?.slug);

  if (r.status === "substituted") {
    push(normalizeTitle(r.project?.title ?? r.picked?.name ?? ""));
    return [...keys].filter(Boolean);
  }

  push(r.source?.slug);
  push(r.source?.modId);
  push(normalizeTitle(r.name));
  push(r.name);
  return [...keys];
}

/** Un membre de groupe matche si un des identifiants du mod le contient. */
function matchesMember(keys: string[], member: string): boolean {
  const m = member.toLowerCase();
  const compact = m.replace(/-/g, "");
  return keys.some((k) => k === m || k.replace(/-/g, "") === compact);
}

export function detectFunctionalConflicts(
  resolutions: ModResolution[],
): FunctionalConflict[] {
  const kept = resolutions.filter(
    (r) => r.status === "ok" || r.status === "substituted",
  );

  const conflicts: FunctionalConflict[] = [];

  for (const group of CONFLICT_GROUPS) {
    const hits = kept.filter((r) =>
      group.members.some((m) => matchesMember(identityKeys(r), m)),
    );
    if (hits.length < 2) continue;

    // Quel membre garder : l'ordre de preference du groupe, sinon le plus
    // ancien dans la liste (donc le pack A en premier).
    const rank = (r: ModResolution) => {
      const keys = identityKeys(r);
      const i = (group.preference ?? []).findIndex((p) => matchesMember(keys, p));
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    const sorted = [...hits].sort((a, b) => rank(a) - rank(b));
    const winner = sorted[0];

    conflicts.push({
      groupId: group.id,
      groupLabel: group.label,
      explanation: group.explanation,
      severity: group.severity,
      members: sorted.map((r) => ({
        key: r.key,
        name: r.name,
        recommended: r === winner,
        note:
          r === winner
            ? group.preference?.length
              ? "recommande pour cette configuration"
              : "premier arrive"
            : undefined,
      })),
    });
  }

  return conflicts.sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "hard" ? -1 : 1,
  );
}
