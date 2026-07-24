// ponytail: extracted from App.tsx. Reads state from the workspace
// context. The LSP plugin is detached on unmount so the bridge doesn't
// leak server processes when the editor route is no longer active.
import { AlertCircle, ArrowLeft, Braces, Check, Code2, FolderOpen, Loader2, MessageSquare, RefreshCw, Save, Search } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { CodeEditor } from './CodeEditor';
import { useWorkspaceStore } from '../workspace-context';
import { useLspExtension } from '../lib/lsp';
import { fileLanguage, relativePath } from '../lib/utils';

export function EditorPanel() {
  const store = useWorkspaceStore();
  const navigate = useNavigate();
  const { workspace, selectedFile, fileContent, fileLoading, fileDirty, saveState } = store;
  const lspExtension = useLspExtension(selectedFile, workspace?.path ?? '');
  const lineCount = useMemo(() => Math.max(1, fileContent.split('\n').length), [fileContent]);

  if (!workspace) return null;
  return (
    <section className="panel editor-panel">
      <div className="editor-topline">
        <Button variant="ghost" size="icon" className="mobile-back" onClick={() => navigate({ to: '/files' })} aria-label="Back to explorer"><ArrowLeft size={17} /></Button>
        <span className="editor-kicker">EDITOR</span>
        <span className="editor-separator">/</span>
        <span className="editor-root-name">{workspace.name}</span>
        <div className="editor-actions">
          <Button variant="ghost" size="icon" onClick={() => void store.reloadCurrentFile()} disabled={!selectedFile || store.fileLoading} aria-label="Reload file"><RefreshCw size={15} className={store.fileLoading ? 'spin' : ''} /></Button>
          <Button variant={fileDirty ? 'default' : 'ghost'} size="sm" onClick={() => void store.saveCurrentFile()} disabled={!selectedFile || !fileDirty || saveState === 'saving'}>{saveState === 'saving' ? <Loader2 size={14} className="spin" /> : <Save size={14} />}<span>{saveState === 'saving' ? 'Saving' : 'Save'}</span></Button>
        </div>
      </div>
      {selectedFile ? (
        <>
          <div className="editor-tabbar"><div className="editor-tab active"><EntryIcon entry={selectedFile} /><span>{selectedFile.name}</span>{fileDirty && <span className="tab-dirty" />}</div><div className="editor-tab-meta">{fileLanguage(selectedFile.name)}</div></div>
          <div className="editor-breadcrumb"><span>{workspace.name}</span><span className="breadcrumb-sep">›</span><span>{relativePath(selectedFile.path, workspace.path)}</span>{fileDirty && <Badge className="unsaved-badge">unsaved</Badge>}</div>
          <div className="code-editor-wrap">
            {fileLoading ? <div className="editor-loading"><Loader2 size={20} className="spin" /><span>Reading file…</span></div> : <CodeEditor value={fileContent} filename={selectedFile.name} reportedLanguage={selectedFile.language} onChange={store.setFileContent} onSave={() => void store.saveCurrentFile()} extraExtensions={lspExtension} />}
          </div>
          <div className="editor-statusbar"><div><Braces size={13} /><span>{selectedFile.language ?? 'plaintext'}</span><span className="statusbar-divider" /><span>{lineCount} lines</span></div><div>{saveState === 'error' ? <span className="save-error"><AlertCircle size={13} /> save failed</span> : saveState === 'saving' ? 'saving…' : fileDirty ? 'unsaved changes' : <><Check size={13} /> saved</>}</div></div>
        </>
      ) : (
        <EditorWelcome workspace={workspace} />
      )}
    </section>
  );
}

function EntryIcon({ entry, open }: { entry: { name: string; kind: string }; open?: boolean }) {
  if (entry.kind === 'directory') return open ? <span>📂</span> : <FolderOpen size={16} />;
  const ext = entry.name.split('.').pop()?.toLowerCase();
  if (['ts', 'tsx', 'js', 'jsx', 'vue'].includes(ext ?? '')) return <Code2 size={16} />;
  return <span>📄</span>;
}

function EditorWelcome({ workspace }: { workspace: { name: string } }) {
  return (
    <div className="editor-welcome"><div className="welcome-mark"><Code2 size={29} /></div><div className="editor-welcome-kicker">WORKSPACE READY</div><h2>Select a file to begin</h2><p>Choose a file from the explorer to read it directly from <strong>{workspace.name}</strong>.</p><div className="welcome-shortcuts"><div><span className="shortcut-icon"><Search size={14} /></span><span>Use the file filter</span></div><div><span className="shortcut-icon"><MessageSquare size={14} /></span><span>Open the Pi agent</span></div></div></div>
  );
}
