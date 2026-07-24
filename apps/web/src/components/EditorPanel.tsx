// ponytail: editor panel chrome (topline, tabbar, breadcrumb,
// statusbar) with Tailwind utilities. The CodeMirror mount is
// unchanged — it has its own scoped CSS that ships with the editor.
import { useLspExtension } from '../lib/lsp';
import { fileLanguage } from '../lib/utils';
import { useMemo, useRef, useState, useCallback } from 'react';
import type { EditorView } from '@codemirror/view';
import { openLintPanel, closeLintPanel } from '@codemirror/lint';
import { useNavigate } from '@tanstack/react-router';
import { AlertCircle, ArrowLeft, Braces, Check, Code2, Loader2, MessageSquareWarning, RefreshCw, Save } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { CodeEditor } from './CodeEditor';
import { useWorkspaceStore } from '../workspace-context';
import { routeWithWorkspace } from '../router';

export function EditorPanel() {
  const store = useWorkspaceStore();
  const navigate = useNavigate();
  const { workspace, selectedFile, fileContent, fileLoading, fileDirty, saveState } = store;
  const lspExtension = useLspExtension(selectedFile, workspace?.path ?? '');
  const lineCount = useMemo(() => Math.max(1, fileContent.split('\n').length), [fileContent]);
  // ponytail: mobile can't hover the gutter or use Ctrl-Shift-M, so the
  // parent keeps a handle to the view and a live diagnostic count to drive
  // a touch-friendly Problems toggle.
  const viewRef = useRef<EditorView | null>(null);
  const [diagnosticCount, setDiagnosticCount] = useState(0);
  const toggleProblems = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    // ponytail: read live panel state from the DOM — the lint panel isn't
    // exposed as a public field, so DOM presence is the source of truth.
    const open = !!view.dom.querySelector('.cm-panel-lint');
    if (open) closeLintPanel(view); else openLintPanel(view);
  }, []);

  if (!workspace) return null;
  return (
    <section className="bg-[#0b1119] flex flex-col h-full">
      <div className="h-[42px] shrink-0 flex items-center gap-2 px-3 border-b border-border text-subtle">
        <Button variant="ghost" size="icon" onClick={() => navigate({ to: routeWithWorkspace('/files', workspace.path) })} aria-label="Back to files" className="md:hidden">
          <ArrowLeft size={17} />
        </Button>
        <span className="text-subtle font-mono text-[9px] font-medium tracking-[0.13em] leading-none uppercase">EDITOR</span>
        <span className="text-[#344552]">/</span>
        <span className="overflow-hidden max-w-[240px] text-[#667887] font-mono text-[10px] text-ellipsis whitespace-nowrap">{workspace.name}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {selectedFile && (
            <Button
              variant={diagnosticCount > 0 ? 'default' : 'ghost'}
              size="sm"
              onClick={toggleProblems}
              aria-label="Problems"
              className="relative"
            >
              <MessageSquareWarning size={14} />
              <span>Problems</span>
              {diagnosticCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-semibold">
                  {diagnosticCount}
                </span>
              )}
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => void store.reloadCurrentFile()} disabled={!selectedFile || store.fileLoading} aria-label="Reload file">
            <RefreshCw size={15} className={store.fileLoading ? 'spin' : ''} />
          </Button>
          <Button variant={fileDirty ? 'default' : 'ghost'} size="sm" onClick={() => void store.saveCurrentFile()} disabled={!selectedFile || !fileDirty || saveState === 'saving'}>
            {saveState === 'saving' ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            <span>{saveState === 'saving' ? 'Saving' : 'Save'}</span>
          </Button>
        </div>
      </div>
      {selectedFile ? (
        <>
          <div className="h-[39px] shrink-0 flex items-stretch justify-between border-b border-border bg-[#0e151e]">
            <div className="relative flex items-center gap-1.5 min-w-[140px] max-w-[280px] px-3.5 border-r border-border text-fg font-mono text-[11px]">
              <Code2 size={16} className="text-blue" />
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{selectedFile.name}</span>
              {fileDirty && <span className="w-1.5 h-1.5 ml-1 rounded-full bg-accent" />}
              <span className="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-accent shadow-[0_0_10px_rgba(141,244,189,0.5)]" />
            </div>
            <div className="flex items-center px-3.5 text-subtle font-mono text-[9px] uppercase">{fileLanguage(selectedFile.name)}</div>
          </div>
          <div className="h-[31px] shrink-0 flex items-center gap-1.5 px-4 border-b border-[rgba(32,45,58,0.7)] text-subtle font-mono text-[10px]">
            <span>{workspace.name}</span>
            <span className="text-[#8695a3]">›</span>
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[#9aaab6]">{selectedFile.path}</span>
            {fileDirty && <Badge className="ml-auto text-orange border-orange/20 bg-orange/[0.07] text-[8px]">unsaved</Badge>}
          </div>
          <div className="flex-1 min-h-0 relative">
            {fileLoading ? (
              <div className="absolute inset-0 flex items-center justify-center gap-2.5 text-muted font-mono text-[11px]">
                <Loader2 size={20} className="spin" />
                <span>Reading file…</span>
              </div>
            ) : (
              <CodeEditor
                value={fileContent}
                filename={selectedFile.name}
                reportedLanguage={selectedFile.language}
                onChange={store.editFileContent}
                onSave={() => void store.saveCurrentFile()}
                extraExtensions={lspExtension}
                onMount={(view) => { viewRef.current = view; }}
                onDiagnosticsChange={setDiagnosticCount}
              />
            )}
          </div>
          <div className="h-[27px] shrink-0 flex items-center justify-between px-3 border-t border-border bg-[#0f1922] text-subtle font-mono text-[9px]">
            <div className="flex items-center gap-1.5">
              <Braces size={13} />
              <span>{selectedFile.language ?? 'plaintext'}</span>
              <span className="w-px h-3 bg-border" />
              <span>{lineCount} lines</span>
            </div>
            <div>
              {saveState === 'error' ? (
                <span className="inline-flex items-center gap-1 text-danger"><AlertCircle size={13} /> save failed</span>
              ) : saveState === 'saving' ? 'saving…' : fileDirty ? 'unsaved changes' : (
                <><Check size={13} className="inline" /> saved</>
              )}
            </div>
          </div>
        </>
      ) : (
        <EditorWelcome workspace={workspace} />
      )}
    </section>
  );
}

function EditorWelcome({ workspace }: { workspace: { name: string } }) {
  return (
    <div className="flex-1 grid place-items-center px-5">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 mx-auto grid place-items-center rounded-2xl border border-border bg-surface text-muted mb-4">
          <Code2 size={29} />
        </div>
        <div className="text-subtle font-mono text-[9px] tracking-[0.13em] uppercase mb-1.5">WORKSPACE READY</div>
        <h2 className="m-0 mb-2 text-fg text-base font-semibold">Select a file to begin</h2>
        <p className="text-muted text-[12px] leading-[1.5] mb-4">
          Choose a file from the explorer to read it directly from <strong className="text-fg font-semibold">{workspace.name}</strong>.
        </p>
        <div className="flex flex-col gap-1.5 text-muted text-[11px]">
          <div className="inline-flex items-center gap-2 justify-center"><span className="text-accent"><Code2 size={14} /></span> Use the file filter</div>
          <div className="inline-flex items-center gap-2 justify-center"><span className="text-accent"><Code2 size={14} /></span> Open the Pi agent</div>
        </div>
      </div>
    </div>
  );
}
