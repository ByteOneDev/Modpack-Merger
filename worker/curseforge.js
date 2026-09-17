/**
 * Relais CurseForge.
 *
 * L'API CurseForge exige une cle secrete et refuse les appels venant d'une
 * page web. Comme le site est statique, il ne peut pas detenir de secret :
 * une cle placee dans le code serait lisible par tous les visiteurs. Ce
 * module tourne cote serveur, garde la cle, et relaie.
 *
 * Ce n'est volontairement pas un proxy generique : seules les routes que
 * l'application utilise reellement sont transmises.
 */

const UPSTREAM = "https://api.curseforge.com";

const ALLOWED_PATHS = [
  /^v1\/mods\/search$/,
  /^v1\/mods$/,
  /^v1\/mods\/files$/,
  /^v1\/mods\/\d+$/,
  /^v1\/mods\/\d+\/files$/,
  /^v1\/fingerprints$/,
];

/** Corps POST plafonne : une liste d'identifiants ne pese jamais plus. */
const MAX_BODY = 256 * 1024;

/** Parametres de requete recopies vers l'amont. Tout le reste est ignore. */
const ALLOWED_PARAMS = [
  "gameId", "classId", "searchFilter", "gameVersion", "modLoaderType",
  "sortField", "sortOrder", "pageSize", "index", "categoryId", "slug",
];

export async function handleCurseforge(request, env, rawPath) {
  // Les hebergeurs normalisent differemment les slashs : on compare toujours
  // un chemin nettoye, sinon "v1/mods/238222/" ne correspondrait a rien.
  const path = rawPath.replace(/^\/+|\/+$/g, "");

  const origin = new URL(request.url).origin;
  const cors = {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || origin,
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
          "Relais present mais non configure : ajoute la variable " +
          "CURSEFORGE_API_KEY dans les reglages du projet Cloudflare.",
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

  const incoming = new URL(request.url).searchParams;
  const qs = new URLSearchParams();
  for (const name of ALLOWED_PARAMS) {
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
