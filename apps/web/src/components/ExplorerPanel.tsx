// ponytail: extracted from App.tsx so the route file can stay one line.
// The panel reads from the workspace context — no props needed.

import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, FileCode2, FileJson, FileText, Folder, FolderOpen, GitBranch, RefreshCw, Search } from 'lucide-react';
import type { FileEntry } from '../api';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { useWorkspaceStore } from '../workspace-context';
import { cn } from '../lib/utils';

export function ExplorerPanel() {
  const store = useWorkspaceStore();
  const { workspace, selectedFile, entries, expanded, filter, visibleEntries } = store;

  const handleToggle = useCallback((entry: FileEntry) => {
    void store.toggleDirectory(entry);
  }, [store]);

  const handleFileClick = useCallback((entry: FileEntry) => {
    if (!workspace) return;
    void store.loadFile(entry, workspace.path);
  }, [store, workspace]);


  const refresh = useCallback(() => {
    if (!workspace) return;
    void store.refreshDirectory(workspace.path);
  }, [store, workspace]);

  if (!workspace) return null;
  return (
    <aside className="panel explorer-panel">
      <div className="panel-heading">
        <div><div className="panel-kicker">WORKSPACE</div><h2>Explorer</h2></div>
        <div className="panel-heading-actions">
          <Button variant="ghost" size="icon" onClick={refresh} aria-label="Refresh files"><RefreshCw size={15} /></Button>
        </div>
      </div>
      <div className="explorer-root"><FolderOpen size={16} /><span title={workspace.path}>{workspace.name}</span><Badge>{visibleEntries.length}</Badge></div>
      <div className="explorer-search"><Search size={14} /><input value={filter} onChange={(event) => store.setFilter(event.target.value)} placeholder="Filter files" aria-label="Filter files" /></div>
      <ScrollArea className="tree-scroll">
        <div className="file-tree">
          {visibleEntries.length ? visibleEntries.map((entry) => (
            <TreeRow key={entry.path} entry={entry} depth={0} expanded={expanded} allEntries={entries} onToggle={handleToggle} onFile={handleFileClick} selectedFile={selectedFile} />
          )) : <div className="tree-empty"><FolderOpen size={22} /><span>{filter ? 'No matching files' : 'This folder is empty'}</span></div>}
        </div>
      </ScrollArea>
      <div className="explorer-bottom"><div><GitBranch size={13} /> filesystem</div><span>•</span><div className="explorer-sync"><span className="status-dot" /> live</div></div>
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
    <div className="tree-group">
      <button
        type="button"
        className={cn('tree-row', selectedFile?.path === entry.path && 'tree-row-selected')}
        style={{ paddingLeft: `${10 + depth * 17}px` }}
        onClick={handleClick}
      >
        {isDirectory ? (isOpen ? <ChevronDown size={14} className="tree-chevron" /> : <ChevronRight size={14} className="tree-chevron" />) : <span className="tree-chevron-spacer" />}
        <EntryIcon entry={entry} open={isOpen} />
        <span className="tree-name">{entry.name}</span>
      </button>
      {isDirectory && isOpen && allEntries[entry.path]?.map((child) => (
        <TreeRow key={child.path} entry={child} depth={depth + 1} expanded={expanded} allEntries={allEntries} onToggle={onToggle} onFile={onFile} selectedFile={selectedFile} />
      ))}
      {isDirectory && isOpen && !allEntries[entry.path] && <div className="tree-loading" style={{ paddingLeft: `${42 + depth * 17}px` }}><RefreshCw size={13} className="spin" /> loading</div>}
    </div>
  );
}

function EntryIcon({ entry, open }: { entry: FileEntry; open?: boolean }) {
  if (entry.kind === 'directory') return open ? <FolderOpen size={16} className="icon-folder" /> : <Folder size={16} className="icon-folder" />;
  const ext = entry.name.split('.').pop()?.toLowerCase();
  if (ext === 'json') return <FileJson size={16} className="icon-json" />;
  if (['ts', 'tsx', 'js', 'jsx', 'vue'].includes(ext ?? '')) return <FileCode2 size={16} className="icon-code" />;
  if (['md', 'txt', 'log'].includes(ext ?? '')) return <FileText size={16} className="icon-text" />;
  return <FileText size={16} className="icon-file" />;
}
