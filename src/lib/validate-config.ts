import { parse as parseToml } from "smol-toml";
import { stripJsonComments } from "@/lib/core/merge/overrides";

/**
 * Verifie la syntaxe d'un fichier de configuration avant de l'enregistrer.
 *
 * Un mod qui lit une config invalide plante au demarrage, ou la remplace
 * par ses valeurs par defaut en effacant la modification. Mieux vaut le
 * dire tout de suite, avec la ligne fautive.
 *
 * @returns null si le fichier est valide ou d'un format non verifie.
 */
export function validateConfig(path: string, text: string): string | null {
  if (/\.(json|jsonc|mcmeta)$/i.test(path)) {
    try {
      JSON.parse(stripJsonComments(text));
      return null;
    } catch (e) {
      return `JSON invalide : ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  if (/\.toml$/i.test(path)) {
    try {
      parseToml(text);
      return null;
    } catch (e) {
      return `TOML invalide : ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
    }
  }
  return null;
}
