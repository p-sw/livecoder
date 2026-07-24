// ponytail: workspace picker with Tailwind utility classes. The previous
// version used `.dialog-field` / `.folder-actions` / etc. — those
// rules were never migrated so the path input had no padding and the
// Browse/Up buttons crowded the field. Now they all use utilities
// from the Tailwind theme so the layout reads as designed.

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
    <div
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="fixed z-20 inset-0 grid place-items-center p-5 bg-[rgba(3,6,9,0.7)] backdrop-blur-md md:items-center max-md:items-end max-md:p-0"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-dialog-title"
        className="w-full max-w-[520px] max-h-[min(690px,calc(100dvh-40px))] flex flex-col border border-border-bright rounded-[13px] bg-[#101821] shadow-[0_24px_80px_rgba(0,0,0,0.5),0_0_0_1px_rgba(141,244,189,0.035)] overflow-hidden md:max-h-[min(690px,calc(100dvh-40px))] max-md:w-full max-md:max-h-[92dvh] max-md:border-b-0 max-md:rounded-t-[15px]"
      >
        <header className="flex items-start justify-between pt-[19px] pr-[19px] pb-[15px] pl-[19px] border-b border-border">
          <div>
            <div className="text-subtle font-mono text-[9px] font-medium tracking-[0.13em] leading-none uppercase">CHOOSE WORKSPACE</div>
            <h2 id="folder-dialog-title" className="m-0 mt-[7px] text-fg text-[19px] font-semibold tracking-[-0.04em]">Open a folder</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="w-[30px] h-[30px] -mt-1.5 -mr-1.5"><span aria-hidden>×</span></Button>
        </header>
        <div className="flex flex-col gap-4 px-5 py-4 flex-1 min-h-0">
          <label className="flex flex-col gap-2">
            <span className="text-[10px] font-mono text-muted tracking-[0.13em] uppercase">Path</span>
            <div className="flex gap-2">
              <input
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="/path/to/folder"
                onKeyDown={(event) => { if (event.key === 'Enter') void chooseFolder(); }}
                className="flex-1 h-9 px-3 text-[13px] text-fg bg-bg border border-border rounded-md outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-subtle focus:border-accent/55 focus:shadow-[0_0_0_3px_rgba(141,244,189,0.08)]"
              />
              <Button variant="ghost" size="sm" onClick={() => navigate(path || '/')}>
                <RefreshCw size={13} /> Browse
              </Button>
              {result?.parentPath && (
                <Button variant="ghost" size="sm" onClick={() => navigate(result.parentPath!)}>↑ Up</Button>
              )}
            </div>
          </label>
          <ScrollArea className="ui-scroll-area flex-1 min-h-[260px] flex flex-col border border-border rounded-md">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-subtle font-mono text-[11px]">
                <Loader2 size={16} className="spin" /> <span>Reading folder…</span>
              </div>
            ) : result?.entries.length ? (
              <ul className="flex flex-col gap-0.5 p-1.5">
                {result.entries.map((entry) => (
                  <li key={entry.path}>
                    <button
                      type="button"
                      onClick={() => navigate(entry.path)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-transparent text-fg text-left text-[13px] font-mono hover:bg-surface-hover"
                    >
                      <FolderOpen size={14} className="text-accent shrink-0" />
                      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{entry.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center gap-2.5 py-12 text-subtle text-center text-[11px]">
                <FolderOpen size={22} />
                <span>No folders here</span>
              </div>
            )}
          </ScrollArea>
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 border border-danger/25 rounded-md text-danger bg-danger/10 text-[11px]">
              ⚠ {error}
            </div>
          )}
        </div>
        <footer className="flex items-center justify-between gap-2.5 px-5 pt-[15px] pb-[17px] max-md:pb-[calc(17px+env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-2 text-subtle text-[10px] font-mono"><span className="w-1.5 h-1.5 rounded-full bg-accent-strong" /> folders only</div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void chooseFolder()} disabled={!result || opening}>
              {opening ? <Loader2 className="spin" size={16} /> : <FolderOpen size={16} />} Open this folder
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
