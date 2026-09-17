/**
 * Relais de telechargement de jars — Cloudflare Pages Function.
 *
 * Le navigateur ne peut pas toujours recuperer un jar directement : les CDN
 * de mods n'envoient pas tous les en-tetes CORS. Quand l'app est hebergee sur
 * une plateforme qui execute des fonctions, l'export "pack complet" passe par
 * ici et fonctionne pour tous les mods.
 *
 * C'est un relais qui prend une URL en parametre : c'est exactement la forme
 * d'une SSRF si on ne se protege pas. Trois verrous : liste blanche d'hotes,
 * HTTPS obligatoire, et revalidation apres chaque redirection.
 */

const ALLOWED_HOSTS = new Set([
  "cdn.modrinth.com",
  "edge.forgecdn.net",
  "mediafilez.forgecdn.net",
  "media.forgecdn.net",
  "github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "gitlab.com",
]);

const MAX_BYTES = 400 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function allowed(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export async function onRequestGet(context) {
  const { request } = context;
  const origin = new URL(request.url).origin;
  const cors = { "Access-Control-Allow-Origin": origin, Vary: "Origin" };

  const target = new URL(request.url).searchParams.get("url");
  if (!target) {
    return json({ error: "Parametre url manquant." }, 400, cors);
  }
  if (!allowed(target)) {
    return json(
      { error: "Hote non autorise. Seuls les CDN de mods connus sont relayes." },
      403,
      cors,
    );
  }

  // Redirections suivies a la main : "redirect: follow" empecherait de
  // verifier que chaque saut reste dans la liste blanche.
  let current = target;
  let res;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    res = await fetch(current, { redirect: "manual" }).catch(() => null);
    if (!res) return json({ error: "Telechargement impossible." }, 502, cors);

    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) break;
      current = new URL(next, current).toString();
      if (!allowed(current)) {
        return json({ error: "Redirection vers un hote non autorise." }, 403, cors);
      }
      continue;
    }
    break;
  }

  if (!res || !res.ok) {
    return json({ error: `Le CDN a repondu ${res?.status ?? "rien"}.` }, 502, cors);
  }

  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > MAX_BYTES) {
    return json({ error: "Fichier trop volumineux." }, 413, cors);
  }

  return new Response(res.body, {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": "application/java-archive",
      // Le contenu est un binaire tiers : on interdit toute interpretation.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "attachment",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" },
  });
}
