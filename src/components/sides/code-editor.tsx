"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

/**
 * Editeur de code pour les fichiers de configuration.
 *
 * CodeMirror est charge a la premiere ouverture seulement : la plupart des
 * utilisateurs n'editeront jamais un fichier, ils n'ont pas a payer son
 * poids au chargement de la page.
 */
export function CodeEditor({
  path,
  initial,
  onChange,
  label,
}: {
  path: string;
  initial: string;
  onChange: (text: string) => void;
  /** nom accessible de la zone d'edition */
  label: string;
}) {
  const host = React.useRef<HTMLDivElement>(null);
  const change = React.useRef(onChange);
  change.current = onChange;
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let view: { destroy: () => void } | null = null;
    let vivant = true;
    setReady(false);

    void (async () => {
      const [
        { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter },
        { EditorState },
        { defaultKeymap, history, historyKeymap, indentWithTab },
        { syntaxHighlighting, defaultHighlightStyle, bracketMatching, StreamLanguage },
        { searchKeymap, highlightSelectionMatches },
      ] = await Promise.all([
        import("@codemirror/view"),
        import("@codemirror/state"),
        import("@codemirror/commands"),
        import("@codemirror/language"),
        import("@codemirror/search"),
      ]);

      // Coloration selon l'extension ; les formats sans mode restent en texte.
      let language = null;
      if (/\.(json|json5|jsonc|mcmeta)$/i.test(path)) {
        language = (await import("@codemirror/lang-json")).json();
      } else if (/\.toml$/i.test(path)) {
        language = StreamLanguage.define((await import("@codemirror/legacy-modes/mode/toml")).toml);
      } else if (/\.(properties|cfg|ini|conf)$/i.test(path)) {
        language = StreamLanguage.define(
          (await import("@codemirror/legacy-modes/mode/properties")).properties,
        );
      } else if (/\.(ya?ml)$/i.test(path)) {
        language = StreamLanguage.define((await import("@codemirror/legacy-modes/mode/yaml")).yaml);
      } else if (/\.(js|zs)$/i.test(path)) {
        language = StreamLanguage.define(
          (await import("@codemirror/legacy-modes/mode/javascript")).javascript,
        );
      }
      if (!vivant || !host.current) return;

      view = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: initial,
          extensions: [
            lineNumbers(),
            highlightActiveLine(),
            highlightActiveLineGutter(),
            history(),
            bracketMatching(),
            highlightSelectionMatches(),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            // Tab indente ; Echap puis Tab rend la main a la navigation clavier.
            keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
            EditorView.lineWrapping,
            EditorView.contentAttributes.of({ "aria-label": label }),
            EditorView.updateListener.of((u) => {
              if (u.docChanged) change.current(u.state.doc.toString());
            }),
            EditorView.theme({
              "&": { fontSize: "12.5px", height: "100%", backgroundColor: "var(--background)" },
              ".cm-content": { fontFamily: "var(--font-mono, ui-monospace, monospace)", caretColor: "var(--foreground)" },
              ".cm-gutters": {
                backgroundColor: "var(--muted)",
                color: "var(--muted-foreground)",
                border: "none",
              },
              ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--primary) 6%, transparent)" },
              ".cm-activeLineGutter": { backgroundColor: "color-mix(in oklab, var(--primary) 12%, transparent)" },
              "&.cm-focused": { outline: "2px solid var(--ring)", outlineOffset: "-2px" },
              ".cm-scroller": { overflow: "auto" },
            }),
            ...(language ? [language] : []),
          ],
        }),
      });
      setReady(true);
    })();

    return () => {
      vivant = false;
      view?.destroy();
    };
    // L'editeur est recree a chaque fichier ouvert ; `initial` ne change
    // qu'avec lui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return (
    <div className="relative h-full min-h-72">
      {!ready && (
        <p className="text-muted-foreground absolute inset-0 flex items-center justify-center gap-2 text-sm" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Chargement de l&apos;éditeur…
        </p>
      )}
      <div ref={host} className="h-full" />
    </div>
  );
}
