/**
 * Relais CurseForge pour Modpack Merger.
 *
 * Pourquoi ce fichier existe : l'API CurseForge exige une cle secrete et
 * n'envoie pas d'en-tetes CORS. Une application statique ne peut donc ni
 * l'appeler depuis le navigateur, ni detenir la cle sans la rendre publique.
 * Ce Worker garde la cle cote serveur et relaie les requetes.
 *
 * Deploiement (gratuit, ~5 minutes) :
 *
 *   npm install -g wrangler
 *   wrangler login
 *   wrangler deploy proxy/curseforge-worker.js --name curseforge-relay --compatibility-date 2026-01-01
 *   wrangler secret put CURSEFORGE_API_KEY --name curseforge-relay
 *
 * Colle ensuite l'URL affichee (https://curseforge-relay.<toi>.workers.dev)
 * dans Parametres -> Sources de mods.
 *
 * ALLOWED_ORIGINS limite qui peut utiliser ton relais. Laisse "*" pour un
 * usage personnel, ou mets ton domaine GitHub Pages pour que ta cle ne soit
 * pas consommee par d'autres :
 *
 *   wrangler secret put ALLOWED_ORIGINS --name curseforge-relay
 *   # valeur : https://<toi>.github.io
 */

const UPSTREAM = "https://api.curseforge.com";

/** Seules ces routes sont relayees : le relais n'est pas un proxy ouvert. */
const ALLOWED_PATHS = [
  /^\/v1\/mods\/search$/,
  /^\/v1\/mods$/,
  /^\/v1\/mods\/files$/,
  /^\/v1\/mods\/\d+$/,
  /^\/v1\/mods\/\d+\/files$/,
  /^\/v1\/fingerprints$/,
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") ?? "";
    const allowed = (env.ALLOWED_ORIGINS ?? "*")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const originOk =
      allowed.includes("*") || (origin && allowed.includes(origin));
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes("*") ? "*" : origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (!originOk) {
      return json({ error: "Origine non autorisee par ce relais." }, 403, cors);
    }

    const url = new URL(request.url);
    if (!ALLOWED_PATHS.some((re) => re.test(url.pathname))) {
      return json({ error: `Route non relayee : ${url.pathname}` }, 404, cors);
    }

    // La cle du Worker prime ; celle envoyee par le client sert de repli pour
    // ceux qui preferent la garder chez eux plutot que dans le Worker.
    const key = env.CURSEFORGE_API_KEY || request.headers.get("x-api-key");
    if (!key) {
      return json(
        { error: "Aucune cle CurseForge : definis le secret CURSEFORGE_API_KEY." },
        500,
        cors,
      );
    }

    const upstream = new Request(UPSTREAM + url.pathname + url.search, {
      method: request.method,
      headers: {
        "x-api-key": key,
        Accept: "application/json",
        ...(request.method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: request.method === "POST" ? await request.text() : undefined,
    });

    const res = await fetch(upstream);
    const body = await res.text();

    return new Response(body, {
      status: res.status,
      headers: {
        ...cors,
        "Content-Type": "application/json",
        // Les metadonnees de mods bougent peu : un cache court epargne
        // le quota de l'API.
        "Cache-Control": res.ok ? "public, max-age=300" : "no-store",
      },
    });
  },
};

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
