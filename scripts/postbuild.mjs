/**
 * Finalise l'export statique.
 *
 * Deux choses que `next build` ne fait pas :
 *
 *  - copier les fichiers de `deploy/`. Ils commencent par un underscore
 *    (_headers, _redirects), or Next ignore ces noms dans `public/` : ils sont
 *    reserves a son propre usage. Il faut donc les poser apres coup.
 *  - creer `.nojekyll`, sans lequel GitHub Pages refuse de servir le dossier
 *    `_next/` pour cette meme raison d'underscore.
 */
import { cp, writeFile, readdir, access } from "node:fs/promises";
import { join } from "node:path";

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Trouve le dossier exporte. Next ecrit dans `out/` en configuration par
 * defaut, mais dans le distDir lui-meme quand celui-ci est personnalise
 * (ce que fait NEXT_DIST_DIR pour construire sans perturber un serveur de
 * developpement en cours).
 */
async function findOutDir() {
  const candidates = [
    process.env.NEXT_OUT_DIR,
    "out",
    process.env.NEXT_DIST_DIR,
  ].filter(Boolean);

  for (const dir of candidates) {
    if (await exists(join(dir, "index.html"))) return dir;
  }
  return null;
}

const OUT = await findOutDir();
if (!OUT) {
  console.error("postbuild : aucun dossier exporte trouve, le build a-t-il reussi ?");
  process.exit(1);
}

const copied = [];
if (await exists("deploy")) {
  for (const name of await readdir("deploy")) {
    await cp(join("deploy", name), join(OUT, name), { recursive: true });
    copied.push(name);
  }
}

await writeFile(join(OUT, ".nojekyll"), "");
copied.push(".nojekyll");

console.log(`postbuild : ${copied.join(", ")}`);
