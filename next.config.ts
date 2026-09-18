import type { NextConfig } from "next";

/**
 * L'app est entierement cliente : elle s'exporte en fichiers statiques et se
 * deploie sans serveur. basePath est necessaire pour un "project site"
 * GitHub Pages (https://<user>.github.io/<repo>/) et se regle a la
 * construction via NEXT_PUBLIC_BASE_PATH.
 *
 * NEXT_DIST_DIR permet de construire dans un dossier separe : un `next build`
 * lance pendant qu'un `next dev` tourne ecraserait sinon son cache webpack et
 * ferait planter le serveur de developpement.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  assetPrefix: basePath || undefined,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,

  /**
   * Relais CurseForge en developpement.
   *
   * Le Worker deploye ne renvoie d'en-tete CORS que pour sa propre origine :
   * depuis `next dev`, CurseForge est donc injoignable et la moitie du
   * catalogue devient invisible. Cette reecriture fait passer /api/ par le
   * serveur de developpement, qui n'est pas soumis a la politique d'origine.
   *
   * Activee seulement si NEXT_PUBLIC_DEV_RELAY est renseignee, et ignoree a
   * l'export statique : la production sert ces routes avec son propre Worker.
   */
  async rewrites() {
    const relais = process.env.NEXT_PUBLIC_DEV_RELAY?.replace(/\/+$/, "");
    if (process.env.NODE_ENV !== "development" || !relais) return [];
    return [{ source: "/api/:chemin*", destination: `${relais}/api/:chemin*` }];
  },
};

export default nextConfig;
