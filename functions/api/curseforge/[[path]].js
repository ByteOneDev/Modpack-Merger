/**
 * Relais CurseForge integre — Cloudflare Pages Function.
 *
 * Pourquoi ce fichier plutot qu'un Worker separe : Cloudflare Pages sert le
 * dossier `out/` en statique ET execute ce qui se trouve dans `functions/`.
 * Le meme depot donne donc un site statique et une petite API, sans second
 * deploiement. Sur GitHub Pages, ce fichier est simplement ignore et l'app
 * bascule sur Modrinth seul (ou sur un relais externe si l'utilisateur en
 * renseigne un).
 *
 * La cle vit dans une variable d'environnement du projet Pages
 * (Settings -> Environment variables -> CURSEFORGE_API_KEY, chiffree).
 * Elle n'est jamais envoyee au navigateur.
 */

const UPSTREAM = "https://api.curseforge.com";

/** Le relais n'est pas un proxy ouvert : seules ces routes sont transmises. */
const ALLOWED_PATHS = [
  /^v1\/mods\/search$/,
  /^v1\/mods$/,
  /^v1\/mods\/files$/,
  /^v1\/mods\/\d+$/,
  /^v1\/mods\/\d+\/files$/,
  /^v1\/fingerprints$/,
];

/** Corps POST plafonne : une liste d'ids ne pese jamais plus que ca. */
const MAX_BODY = 256 * 1024;

export async function onRequest(context) {
  const { request, env, params } = context;
  // Les hebergeurs normalisent differemment les slashs de fin : on compare
  // toujours un chemin nettoye, sinon "v1/mods/238222/" ne matcherait pas.
  const path = (Array.isArray(params.path) ? params.path.join("/") : (params.path ?? ""))
    .replace(/^\/+|\/+$/g, "");

  const cors = {
    // Meme origine que le site : pas besoin d'ouvrir a des tiers.
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || new URL(request.url).origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "Methode non autorisee." }, 405, cors);
  }
  if (!ALLOWED_PATHS.some((re) => re.test(path))) {
    return json({ error: `Route non relayee : ${path}` }, 404, cors);
  }

  const key = env.CURSEFORGE_API_KEY;
  if (!key) {
    return json(
      {
        error:
          "Relais present mais non configure : ajoute la variable d'environnement " +
          "CURSEFORGE_API_KEY dans les reglages du projet Pages.",
      },
      503,
      cors,
    );
  }

  let body;
  if (request.method === "POST") {
    body = await request.text();
    if (body.length > MAX_BODY) {
      return json({ error: "Corps de requete trop volumineux." }, 413, cors);
    }
  }

  // Seuls les parametres attendus sont transmis : la chaine de requete du
  // client ne doit pas pouvoir injecter n'importe quoi en amont.
  const incoming = new URL(request.url).searchParams;
  const allowedParams = [
    "gameId", "classId", "searchFilter", "gameVersion", "modLoaderType",
    "sortField", "sortOrder", "pageSize", "index", "categoryId", "slug",
  ];
  const qs = new URLSearchParams();
  for (const name of allowedParams) {
    const v = incoming.get(name);
    if (v !== null && v.length <= 200) qs.set(name, v);
  }

  let res;
  try {
    res = await fetch(`${UPSTREAM}/${path}${qs.toString() ? `?${qs}` : ""}`, {
      method: request.method,
      headers: {
        "x-api-key": key,
        Accept: "application/json",
        ...(request.method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body,
    });
  } catch {
    return json({ error: "CurseForge est injoignable." }, 502, cors);
  }

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      // Les metadonnees de mods bougent peu : un cache court epargne le quota.
      "Cache-Control": res.ok ? "public, max-age=300" : "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" },
  });
}
