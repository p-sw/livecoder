// ponytail: file tree panel. Each rule below was a hand-rolled CSS
// selector before the Tailwind v4 migration. Now every className
// string is built from utilities so adding a new node type doesn't
// require touching the global stylesheet.

import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  RefreshCw,
  Search,
} from 'lucide-react';
import type { FileEntry } from '../api';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { useWorkspaceStore } from '../workspace-context';
import { cn } from '../lib/utils';

export function ExplorerPanel() {
  const store = useWorkspaceStore();
  const { workspace, selectedFile, entries, expanded, filter, visibleEntries } = store;

  const handleFileClick = useCallback((entry: FileEntry) => {
    if (!workspace) return;
    void store.loadFile(entry, workspace.path);
  }, [store, workspace]);

  const handleToggle = useCallback((entry: FileEntry) => {
    void store.toggleDirectory(entry);
  }, [store]);

  const refresh = useCallback(() => {
    if (!workspace) return;
    void store.refreshDirectory(workspace.path);
  }, [store, workspace]);

  if (!workspace) return null;
  return (
    <aside className="bg-surface flex flex-col h-full min-h-0">
      <div className="h-16 shrink-0 flex items-center justify-between px-3.5 pl-4 border-b border-[rgba(32,45,58,0.7)]">
        <div>
          <div className="text-subtle font-mono text-[9px] font-medium tracking-[0.13em] leading-none uppercase">WORKSPACE</div>
          <h2 className="m-0 mt-1 text-fg text-sm font-semibold tracking-[-0.02em]">Explorer</h2>
        </div>
        <div className="flex gap-px">
          <Button variant="ghost" size="icon" onClick={refresh} aria-label="Refresh files">
            <RefreshCw size={15} />
          </Button>
        </div>
      </div>
      <div className="h-[39px] shrink-0 flex items-center gap-2 px-3 border-b border-border text-accent bg-accent/[0.035]">
        <FolderOpen size={16} />
        <span title={workspace.path} className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-fg text-xs font-semibold">{workspace.name}</span>
        <Badge className="ml-auto px-1.5 py-0 text-subtle border-0 bg-transparent text-[9px]">{visibleEntries.length}</Badge>
      </div>
      <div className="h-[42px] shrink-0 flex items-center gap-2 px-3 border-b border-border text-subtle">
        <Search size={14} />
        <input
          value={filter}
          onChange={(event) => store.setFilter(event.target.value)}
          placeholder="Filter files"
          aria-label="Filter files"
          className="min-w-0 flex-1 border-0 outline-0 bg-transparent text-fg text-xs placeholder:text-subtle"
        />
      </div>
      <ScrollArea className="ui-scroll-area">
        <div className="px-1 py-2 pb-4">
          {visibleEntries.length ? (
            visibleEntries.map((entry) => (
              <TreeRow
                key={entry.path}
                entry={entry}
                depth={0}
                expanded={expanded}
                allEntries={entries}
                onToggle={handleToggle}
                onFile={handleFileClick}
                selectedFile={selectedFile}
              />
            ))
          ) : (
            <div className="flex flex-col items-center gap-2.5 py-12 text-subtle text-center text-[11px]">
              <FolderOpen size={22} />
              <span>{filter ? 'No matching files' : 'This folder is empty'}</span>
            </div>
          )}
        </div>
      </ScrollArea>
      <div className="h-8 shrink-0 flex items-center gap-2 px-3 border-t border-border text-subtle font-mono text-[9px]">
        <div className="flex items-center gap-1.5"><GitBranch size={13} /> filesystem</div>
        <span>•</span>
        <div className="ml-auto flex items-center gap-1.5 text-[#71917f]">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-strong shadow-none" /> live
        </div>
      </div>
    </aside>
  );
}

function TreeRow({
  entry,
  depth,
  expanded,
  allEntries,
  onToggle,
  onFile,
  selectedFile,
}: {
  entry: FileEntry;
  depth: number;
  expanded: Record<string, boolean>;
  allEntries: Record<string, FileEntry[]>;
  onToggle: (entry: FileEntry) => Promise<void> | void;
  onFile: (entry: FileEntry) => void;
  selectedFile: FileEntry | null;
}) {
  const isDirectory = entry.kind === 'directory';
  const isOpen = Boolean(expanded[entry.path]);
  const navigate = useNavigate();
  const handleClick = useCallback(() => {
    if (isDirectory) {
      void onToggle(entry);
    } else {
      onFile(entry);
      navigate({ to: '/editor' });
    }
  }, [entry, isDirectory, navigate, onFile, onToggle]);

  return (
    <div>
      <button
        type="button"
        className={cn(
          'w-full min-h-[30px] flex items-center gap-1.5 pr-2 border-0 bg-transparent text-left text-[11px] font-mono',
          selectedFile?.path === entry.path && 'bg-accent/[0.11] text-fg',
        )}
        style={{ paddingLeft: `${10 + depth * 17}px` }}
        onClick={handleClick}
      >
        {isDirectory ? (
          isOpen ? <ChevronDown size={14} className="text-subtle" /> : <ChevronRight size={14} className="text-subtle" />
        ) : (
          <span className="w-3.5" />
        )}
        <EntryIcon entry={entry} open={isOpen} />
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{entry.name}</span>
      </button>
      {isDirectory && isOpen && allEntries[entry.path]?.map((child) => (
        <TreeRow key={child.path} entry={child} depth={depth + 1} expanded={expanded} allEntries={allEntries} onToggle={onToggle} onFile={onFile} selectedFile={selectedFile} />
      ))}
      {isDirectory && isOpen && !allEntries[entry.path] && (
        <div className="flex items-center gap-1.5 text-subtle font-mono text-[10px]" style={{ paddingLeft: `${42 + depth * 17}px` }}>
          <RefreshCw size={13} className="spin" /> loading
        </div>
      )}
    </div>
  );
}

function EntryIcon({ entry, open }: { entry: FileEntry; open?: boolean }) {
  if (entry.kind === 'directory') return open ? <FolderOpen size={16} className="text-[#d8ad63]" /> : <Folder size={16} className="text-[#d8ad63]" />;
  const ext = entry.name.split('.').pop()?.toLowerCase();
  if (ext === 'json') return <FileJson size={16} className="text-[#e7c96b]" />;
  if (['ts', 'tsx', 'js', 'jsx', 'vue'].includes(ext ?? '')) return <FileCode2 size={16} className="text-[#70b8f9]" />;
  if (['md', 'txt', 'log'].includes(ext ?? '')) return <FileText size={16} className="text-[#bf9aeb]" />;
  return <FileText size={16} className="text-[#8c9cab]" />;
}
