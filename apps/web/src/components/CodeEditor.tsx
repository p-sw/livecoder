import { useEffect, useRef } from 'react';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, foldGutter, foldKeymap } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { lintKeymap } from '@codemirror/lint';
import { detectLanguage, type LanguageMatch } from '../lib/languages';
import { editorTheme, editorHighlight } from '../lib/editorTheme';

interface CodeEditorProps {
  value: string;
  filename: string;
  reportedLanguage?: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  extraExtensions?: Extension[];
}

export function CodeEditor({ value, filename, reportedLanguage, onChange, onSave, extraExtensions }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment());
  const extraCompartment = useRef(new Compartment());

  // ponytail: keep last received props in refs so the listener can read fresh
  // values without re-creating the editor on every keystroke (CM6 owns state).
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  // Build the editor once; subsequent updates swap language / value in place.
  useEffect(() => {
    if (!hostRef.current) return;

    const match = detectLanguage(filename, reportedLanguage);
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        foldGutter(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        editorHighlight,
        editorTheme,
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          ...lintKeymap,
          ...searchKeymap,
          indentWithTab,
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => { onSaveRef.current?.(); return true; },
          },
        ]),
        languageCompartment.current.of(match.support),
        extraCompartment.current.of(extraExtensions ?? []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ponytail: language swap on file change — compartment reconfig keeps state
  // (cursor, history, selection) intact instead of rebuilding the tree.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const match: LanguageMatch = detectLanguage(filename, reportedLanguage);
    view.dispatch({ effects: languageCompartment.current.reconfigure(match.support) });
  }, [filename, reportedLanguage]);

  // ponytail: external value sync (e.g. file refresh). Skip when content matches —
  // avoids resetting the cursor on every parent render.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  // ponytail: extra extensions (LSP plugin) can change without recreating
  // the editor; the compartment handles reconfiguration cleanly.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: extraCompartment.current.reconfigure(extraExtensions ?? []) });
  }, [extraExtensions]);

  return <div ref={hostRef} className="cm-host" />;
}
