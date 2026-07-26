// ponytail: folder selector is a bottom drawer (vaul/shadcn). Path input
// debounces browse; folder clicks / Up load immediately.

import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, Loader2 } from 'lucide-react';
import { browse, type FileEntry } from '../api';
import { Button } from './ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from './ui/drawer';
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
  const reqId = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback((target: string | undefined) => {
    const id = ++reqId.current;
    setError('');
    setLoading(true);
    void browse(target).then((next) => {
      if (id !== reqId.current) return;
      setResult(next);
      // ponytail: path input is user-owned; only navigate()/typing set it
    }).catch((reason: unknown) => {
      if (id !== reqId.current) return;
      setResult(null);
      const message = reason instanceof Error ? reason.message : 'Failed to read this folder';
      setError(message);
    }).finally(() => {
      if (id === reqId.current) setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    clearTimeout(debounceRef.current);
    setPath(currentPath ?? '');
    load(currentPath);
  }, [currentPath, open, load]);

  useEffect(() => () => {
    clearTimeout(debounceRef.current);
  }, []);

  const navigate = (target: string) => {
    clearTimeout(debounceRef.current);
    setPath(target);
    load(target);
  };

  const onPathChange = (value: string) => {
    setPath(value);
    clearTimeout(debounceRef.current);
    // ponytail: 300ms debounce; tighten if browse feels laggy
    debounceRef.current = setTimeout(() => load(value || '/'), 300);
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

  return (
    <Drawer open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DrawerContent className="max-h-[92dvh] bg-[#101821] border-border-bright">
        <DrawerHeader className="text-left border-b border-border pb-4">
          <div className="text-subtle font-mono text-[9px] font-medium tracking-[0.13em] leading-none uppercase">
            CHOOSE WORKSPACE
          </div>
          <DrawerTitle className="mt-[7px] text-fg text-[19px] font-semibold tracking-[-0.04em]">
            Open a folder
          </DrawerTitle>
          <DrawerDescription className="sr-only">
            Browse the filesystem and open a workspace folder
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex flex-col gap-4 px-5 py-4 flex-1 min-h-0 overflow-hidden">
          <label className="flex flex-col gap-2">
            <span className="text-[10px] font-mono text-muted tracking-[0.13em] uppercase">Path</span>
            <div className="flex gap-2">
              <input
                value={path}
                onChange={(event) => onPathChange(event.target.value)}
                placeholder="/path/to/folder"
                onKeyDown={(event) => { if (event.key === 'Enter') void chooseFolder(); }}
                className="flex-1 h-9 px-3 text-[13px] text-fg bg-bg border border-border rounded-md outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-subtle focus:border-accent/55 focus:shadow-[0_0_0_3px_rgba(141,244,189,0.08)]"
              />
              {result?.parentPath && (
                <Button variant="ghost" size="sm" onClick={() => navigate(result.parentPath!)}>↑ Up</Button>
              )}
            </div>
          </label>

          <ScrollArea className="ui-scroll-area flex-1 min-h-[260px] max-h-[min(420px,50dvh)] flex flex-col border border-border rounded-md">
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

        <DrawerFooter className="flex-row items-center justify-between gap-2.5 border-t border-border pt-[15px] pb-[calc(17px+env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-2 text-subtle text-[10px] font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-strong" /> folders only
          </div>
          <div className="flex items-center gap-2">
            <DrawerClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DrawerClose>
            <Button onClick={() => void chooseFolder()} disabled={!result || opening}>
              {opening ? <Loader2 className="spin" size={16} /> : <FolderOpen size={16} />} Open this folder
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
