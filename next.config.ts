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
};

export default nextConfig;
