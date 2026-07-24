// ponytail: extracted from App.tsx so it's reusable. The dialog is a small
// standalone component; the only store interaction is the `onOpen` callback
// that closes the dialog + opens the workspace.

import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Loader2, RefreshCw } from 'lucide-react';
import { browse, type FileEntry } from '../api';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';

interface WorkspacePickerProps {
  open: boolean;
  onClose: () => void;
  onOpen: (path: string) => Promise<void>;
  currentPath?: string;
}

export function WorkspacePicker({ open, onClose, onOpen, currentPath }: WorkspacePickerProps) {
  const [path, setPath] = useState(currentPath ?? '');
  const [result, setResult] = useState<{ path: string; parentPath: string | null; entries: FileEntry[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setPath(currentPath ?? '');
    setError('');
    setLoading(true);
    void browse(currentPath).then((next) => {
      setResult(next);
      setPath(next.path);
    }).catch((reason: unknown) => {
      setResult(null);
      const message = reason instanceof Error ? reason.message : 'Failed to read this folder';
      setError(message);
    }).finally(() => setLoading(false));
  }, [currentPath, open]);

  const navigate = (target: string) => {
    setPath(target);
    setError('');
    setLoading(true);
    void browse(target).then((next) => {
      setResult(next);
      setPath(next.path);
    }).catch((reason: unknown) => {
      setResult(null);
      const message = reason instanceof Error ? reason.message : 'Failed to read this folder';
      setError(message);
    }).finally(() => setLoading(false));
  };

  const chooseFolder = useCallback(async () => {
    if (!result) return;
    setOpening(true);
    try {
      await onOpen(result.path);
      onClose();
    } finally {
      setOpening(false);
    }
  }, [result, onOpen, onClose]);

  if (!open) return null;
  return (
    <div className="dialog-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="folder-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title">
        <header className="dialog-header">
          <div>
            <div className="dialog-kicker">CHOOSE WORKSPACE</div>
            <h2 id="folder-dialog-title">Open a folder</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><span aria-hidden="true">×</span></Button>
        </header>
        <div className="dialog-body">
          <label className="dialog-field">
            <span>Path</span>
            <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/path/to/folder" onKeyDown={(event) => { if (event.key === 'Enter') void chooseFolder(); }} />
          </label>
          <div className="folder-actions">
            <Button variant="ghost" size="sm" onClick={() => navigate(path || '/')}><RefreshCw size={13} /> Browse</Button>
            {result?.parentPath && <Button variant="ghost" size="sm" onClick={() => navigate(result.parentPath!)}>↑ Up</Button>}
          </div>
          <ScrollArea className="folder-list">
            {loading ? (
              <div className="picker-loading"><Loader2 size={16} className="spin" /> <span>Reading folder…</span></div>
            ) : result?.entries.length ? (
              result.entries.map((entry) => (
                <button className="folder-option" key={entry.path} onClick={() => navigate(entry.path)} type="button">
                  <FolderOpen size={15} />
                  <span className="folder-option-name">{entry.name}</span>
                </button>
              ))
            ) : (
              <div className="picker-empty"><FolderOpen size={22} /><span>No folders here</span></div>
            )}
          </ScrollArea>
          {error && <div className="inline-error">⚠ {error}</div>}
        </div>
        <footer className="dialog-footer">
          <div className="folder-rule"><span className="status-dot" /> folders only</div>
          <div className="dialog-actions"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => void chooseFolder()} disabled={!result || opening}>{opening ? <Loader2 className="spin" size={16} /> : <FolderOpen size={16} />} Open this folder</Button></div>
        </footer>
      </section>
    </div>
  );
}
