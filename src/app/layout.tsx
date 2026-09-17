import type { Metadata } from "next";
import "./globals.css";
import { MergeProvider } from "@/lib/store";
import { AppShell } from "@/components/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: "Modpack Merger",
  description:
    "Fusionne plusieurs modpacks Minecraft, aligne les mods sur un loader commun, remplace ceux qui manquent et estime la RAM necessaire.",
};

/**
 * Le theme est applique avant le premier rendu pour eviter le flash blanc :
 * ce script lit le reglage sauvegarde et pose la classe sur <html>.
 */
const themeScript = `
(function(){try{
  var s = JSON.parse(localStorage.getItem('modpack-merger.settings.v1') || '{}');
  var t = s.theme || 'system';
  var dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}catch(e){}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <MergeProvider>
          <TooltipProvider>
            <AppShell>{children}</AppShell>
          </TooltipProvider>
        </MergeProvider>
      </body>
    </html>
  );
}
