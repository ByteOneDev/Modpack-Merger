/**
 * Point d'entree du Worker Cloudflare.
 *
 * Cloudflare sert d'abord les fichiers statiques produits par `npm run build`
 * (dossier `out/`, declare dans wrangler.toml). Ce Worker ne recoit donc que
 * les requetes qui ne correspondent a aucun fichier : en pratique, les routes
 * /api/, plus les chemins inconnus qu'on renvoie vers la page 404.
 *
 * Sans ce Worker, l'application fonctionne quand meme — c'est un export
 * statique — mais CurseForge reste inaccessible, faute de quoi que ce soit
 * pouvant detenir la cle secrete.
 */

import { handleCurseforge } from "./curseforge.js";
import { handleDownload } from "./download.js";

const CURSEFORGE_PREFIX = "/api/curseforge/";
const DOWNLOAD_PATH = "/api/download";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith(CURSEFORGE_PREFIX)) {
      return handleCurseforge(request, env, path.slice(CURSEFORGE_PREFIX.length));
    }

    if (path === DOWNLOAD_PATH || path === `${DOWNLOAD_PATH}/`) {
      return handleDownload(request);
    }

    // Toute autre requete arrivee jusqu'ici ne correspond a aucun fichier :
    // on rend la page 404 du site plutot qu'une reponse nue.
    if (env.ASSETS) {
      const notFound = await env.ASSETS.fetch(new URL("/404.html", url.origin));
      return new Response(notFound.body, {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
