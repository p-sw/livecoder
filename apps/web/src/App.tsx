import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUp,
  Bot,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  Loader2,
  MessageSquare,
  PanelLeft,
  RefreshCw,
  Save,
  Search,
  Send,
  Sparkles,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import { agentStatus, browse, listEntries, openWorkspace, readFile, saveFile, streamAgentMessage, API_ROOT, type AdapterInfo, type AgentEvent, type FileEntry, type WorkspaceResult } from './api';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { ScrollArea } from './components/ui/scroll-area';
import { CodeEditor } from './components/CodeEditor';
import { useLspExtension } from './lib/lsp';
import { cn, fileLanguage, relativePath } from './lib/utils';
import './styles.css';

type View = 'explorer' | 'editor' | 'agent';
type AgentConnection = 'idle' | 'connecting' | 'ready' | 'thinking' | 'error';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  toolId?: string;
  toolStatus?: string;
  streaming?: boolean;
};

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  text: 'I’m ready to work in this workspace. Ask me to explore the code, explain a file, or make a change.',
};

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceResult | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [view, setView] = useState<View>('explorer');
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [entries, setEntries] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileDirty, setFileDirty] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [chatInput, setChatInput] = useState('');
  const [agentConnection, setAgentConnection] = useState<AgentConnection>('idle');
  const [agentConfigured, setAgentConfigured] = useState<boolean | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [activeAdapter, setActiveAdapter] = useState<string | null>(null);
  const fileRequest = useRef(0);
  const selectedRef = useRef<FileEntry | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    selectedRef.current = selectedFile;
  }, [selectedFile]);

  useEffect(() => {
    dirtyRef.current = fileDirty;
  }, [fileDirty]);

  useEffect(() => {
    if (!fileDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [fileDirty]);

  const openFolder = useCallback(async (path: string) => {
    if (fileDirty && !window.confirm('Discard unsaved changes and open another workspace?')) return;
    const result = await openWorkspace(path);
    setWorkspace(result);
    setEntries({ [result.path]: result.entries });
    setExpanded({});
    setFilter('');
    setSelectedFile(null);
    setFileContent('');
    setFileDirty(false);
    setSaveState('saved');
    setChatMessages([WELCOME_MESSAGE]);
    setAgentConfigured(null);
    setAgentConnection('idle');
    setPickerOpen(false);
    setView('explorer');
  }, [fileDirty]);

  const loadFile = useCallback(async (entry: FileEntry, root: string) => {
    if (fileDirty && selectedFile?.path !== entry.path && !window.confirm('Discard unsaved changes and open another file?')) return;
    const requestId = ++fileRequest.current;
    setSelectedFile(entry);
    setFileLoading(true);
    setFileDirty(false);
    setSaveState('saved');
    setView('editor');
    try {
      const result = await readFile(entry.path, root);
      if (requestId !== fileRequest.current) return;
      setFileContent(result.content);
    } catch (error) {
      if (requestId !== fileRequest.current) return;
      setFileContent(`Unable to open this file.\n\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (requestId === fileRequest.current) setFileLoading(false);
    }
  }, [fileDirty, selectedFile]);

  const refreshDirectory = useCallback(async (path: string) => {
    try {
      const result = await listEntries(path);
      setEntries((current) => ({ ...current, [path]: result.entries }));
    } catch {
      // The directory may have been removed; the explorer remains usable.
    }
  }, []);

  const toggleDirectory = useCallback(async (entry: FileEntry) => {
    const isOpen = expanded[entry.path];
    if (isOpen) {
      setExpanded((current) => ({ ...current, [entry.path]: false }));
      return;
    }
    setExpanded((current) => ({ ...current, [entry.path]: true }));
    if (!entries[entry.path]) {
      try {
        const result = await listEntries(entry.path);
        setEntries((current) => ({ ...current, [entry.path]: result.entries }));
      } catch {
        setExpanded((current) => ({ ...current, [entry.path]: false }));
      }
    }
  }, [entries, expanded]);

  const saveCurrentFile = useCallback(async () => {
    if (!workspace || !selectedFile || !fileDirty) return;
    setSaveState('saving');
    try {
      const result = await saveFile(selectedFile.path, fileContent, workspace.path);
      setSelectedFile((current) => current ? { ...current, size: result.size, modified: result.modified } : current);
      setFileDirty(false);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }, [fileContent, fileDirty, selectedFile, workspace]);

  const reloadCurrentFile = useCallback(async () => {
    if (!workspace || !selectedFile || fileDirty) return;
    setFileLoading(true);
    try {
      const result = await readFile(selectedFile.path, workspace.path);
      setFileContent(result.content);
      setSelectedFile((current) => current ? { ...current, size: result.size, modified: result.modified } : current);
    } catch {
      // Keep the editor content if a file is removed during a refresh.
    } finally {
      setFileLoading(false);
    }
  }, [fileDirty, selectedFile, workspace]);

  useEffect(() => {
    if (!workspace) return;
    const source = new EventSource(`${API_ROOT}/api/watch?workspace=${encodeURIComponent(workspace.path)}`);
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as { type: string; path?: string; directory?: string };
        if (event.type !== 'change') return;
        if (event.directory && event.directory !== workspace.path) void refreshDirectory(event.directory);
        void refreshDirectory(workspace.path);
        const currentFile = selectedRef.current;
        if (currentFile && !dirtyRef.current) {
          void readFile(currentFile.path, workspace.path).then((result) => {
            if (dirtyRef.current || selectedRef.current?.path !== currentFile.path) return;
            setFileContent(result.content);
            setSelectedFile((current) => current ? { ...current, size: result.size, modified: result.modified } : current);
          }).catch(() => undefined);
        }
      } catch {
        // Ignore a malformed filesystem event.
      }
    };
    return () => source.close();
  }, [refreshDirectory, workspace]);

  useEffect(() => {
    if (!workspace) return;
    void agentStatus()
      .then((result) => {
        setAgentConfigured(result.configured);
        setAgentConnection(result.configured ? 'ready' : 'idle');
        setAdapters(result.adapters);
        setActiveAdapter(result.adapter);
      })
      .catch(() => setAgentConfigured(false));
  }, [workspace]);

  const sendChat = useCallback(async (value?: string) => {
    const text = (value ?? chatInput).trim();
    if (!workspace || !text || agentBusy) return;
    setChatInput('');
    const assistantId = `assistant-${Date.now()}`;
    setChatMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: 'user', text },
      { id: assistantId, role: 'assistant', text: '', streaming: true },
    ]);
    setAgentBusy(true);
    setAgentConnection('connecting');

    const updateAssistant = (append: string) => {
      setChatMessages((current) => current.map((message) => (
        message.id === assistantId ? { ...message, text: `${message.text}${append}` } : message
      )));
    };

    const handleEvent = (event: AgentEvent) => {
      if (event.type === 'text') updateAssistant(event.text);
      if (event.type === 'thought') return;
      if (event.type === 'tool') {
        setChatMessages((current) => {
          const found = current.some((message) => message.toolId === event.id);
          if (found) {
            return current.map((message) => message.toolId === event.id
              ? { ...message, text: event.title, toolStatus: event.status }
              : message);
          }
          return [...current, {
            id: `tool-${event.id}`,
            role: 'tool',
            text: event.title,
            toolId: event.id,
            toolStatus: event.status,
          }];
        });
      }
      if (event.type === 'status') {
        setAgentConnection(event.status === 'thinking' ? 'thinking' : event.status === 'connecting' ? 'connecting' : 'ready');
      }
      if (event.type === 'error') {
        updateAssistant(`\n\n${event.message}`);
        setAgentConnection('error');
      }
      if (event.type === 'done') {
        setChatMessages((current) => current.map((message) => message.id === assistantId ? { ...message, streaming: false } : message));
      }
    };
    try {
      const context = selectedFile ? `\n\nThe user is currently viewing ${relativePath(selectedFile.path, workspace.path)}.` : '';
      await streamAgentMessage(workspace.path, `${text}${context}`, handleEvent, activeAdapter ?? undefined);
    } catch (error) {
      updateAssistant(`Unable to reach Pi ACP. ${error instanceof Error ? error.message : String(error)}`);
      setAgentConnection('error');
    } finally {
      setChatMessages((current) => current.map((message) => message.id === assistantId ? { ...message, streaming: false } : message));
      setAgentBusy(false);
    }
  }, [agentBusy, chatInput, selectedFile, workspace, activeAdapter]);
  const visibleEntries = useMemo(() => {
    if (!workspace) return [];
    const rootEntries = entries[workspace.path] ?? [];
    const query = filter.trim().toLowerCase();
    return query ? rootEntries.filter((entry) => entry.name.toLowerCase().includes(query)) : rootEntries;
  }, [entries, filter, workspace]);

  if (!workspace) {
    return (
      <div className="app-shell empty-shell">
        <TopBar workspace={null} onOpen={() => setPickerOpen(true)} />
        <EmptyState onOpen={() => setPickerOpen(true)} />
        <WorkspacePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onOpen={openFolder}
        />
      </div>
    );
  }

  return (
    <div className={`app-shell workspace-shell view-${view}`}>
      <TopBar workspace={workspace} onOpen={() => setPickerOpen(true)} />
      <main className="workspace-layout">
        <ExplorerPanel
          workspace={workspace}
          entries={visibleEntries}
          allEntries={entries}
          expanded={expanded}
          filter={filter}
          onFilter={setFilter}
          onToggle={toggleDirectory}
          onFile={(entry) => void loadFile(entry, workspace.path)}
          selectedFile={selectedFile}
          onRefresh={() => void refreshDirectory(workspace.path)}
        />
        <EditorPanel
          workspace={workspace}
          selectedFile={selectedFile}
          content={fileContent}
          loading={fileLoading}
          dirty={fileDirty}
          saveState={saveState}
          onChange={(value) => { setFileContent(value); setFileDirty(true); setSaveState('saved'); }}
          onSave={() => void saveCurrentFile()}
          onRefresh={() => void reloadCurrentFile()}
          onBack={() => setView('explorer')}
        />
        <AgentPanel
          workspace={workspace}
          messages={chatMessages}
          input={chatInput}
          busy={agentBusy}
          connection={agentConnection}
          configured={agentConfigured}
          adapters={adapters}
          activeAdapter={activeAdapter}
          onSelectAdapter={setActiveAdapter}
          onInput={setChatInput}
          onSend={() => void sendChat()}
          onSuggestion={(value) => void sendChat(value)}
          onBack={() => setView('explorer')}
        />
      </main>
      <MobileNav view={view} onChange={setView} />
      <WorkspacePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onOpen={openFolder}
        currentPath={workspace.path}
      />
    </div>
  );
}

function TopBar({ workspace, onOpen }: { workspace: WorkspaceResult | null; onOpen: () => void }) {
  return (
    <header className="topbar">
      <div className="brand-lockup">
        <div className="brand-mark"><Code2 size={18} strokeWidth={2.5} /></div>
        <div className="brand-wordmark">livecoder</div>
        <span className="brand-divider" />
        <span className="brand-subtitle">workspace</span>
      </div>
      <div className="topbar-center">
        {workspace ? (
          <>
            <FolderOpen size={14} />
            <span className="topbar-workspace-name">{workspace.name}</span>
            <span className="topbar-path">{workspace.path}</span>
          </>
        ) : (
          <span className="empty-workspace-label">No workspace open</span>
        )}
      </div>
      <div className="topbar-actions">
        <Badge className="local-badge"><span className="status-dot" /> local workspace</Badge>
        {workspace ? (
          <Button variant="ghost" size="icon" className="topbar-icon-button" onClick={onOpen} aria-label="Change workspace" title="Change workspace">
            <FolderOpen size={17} />
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={onOpen}><FolderOpen size={15} /> Open folder</Button>
        )}
      </div>
    </header>
  );
}

function EmptyState({ onOpen }: { onOpen: () => void }) {
  return (
    <main className="empty-content">
      <div className="empty-grid-glow" />
      <section className="empty-card">
        <div className="empty-icon-wrap">
          <div className="empty-icon-backdrop" />
          <FolderOpen size={34} strokeWidth={1.5} />
          <span className="empty-icon-pulse" />
        </div>
        <Badge className="eyebrow-badge"><span className="eyebrow-dot" /> ready when you are</Badge>
        <h1>Open a workspace<br /><em>and start building.</em></h1>
        <p className="empty-description">Work with the files on this machine, then ask Pi to inspect, explain, or edit them with you.</p>
        <Button size="lg" className="empty-open-button" onClick={onOpen}><FolderOpen size={18} /> Choose a folder <span className="button-arrow">↗</span></Button>
        <div className="empty-hint"><span className="status-dot" /><span>Local files, no account required</span></div>
      </section>
      <div className="empty-footer"><span>LIVECODER 01</span><span className="footer-line" /><span>DIRECT FILESYSTEM ACCESS</span></div>
    </main>
  );
}

function WorkspacePicker({
  open,
  onClose,
  onOpen,
  currentPath,
}: {
  open: boolean;
  onClose: () => void;
  onOpen: (path: string) => Promise<void>;
  currentPath?: string;
}) {
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
      setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => setLoading(false));
  }, [currentPath, open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;

  const navigate = (nextPath?: string) => {
    setLoading(true);
    setError('');
    void browse(nextPath).then((next) => {
      setResult(next);
      setPath(next.path);
    }).catch((reason: unknown) => {
      setResult(null);
      setError(reason instanceof Error ? reason.message : 'That path is not a folder');
    }).finally(() => setLoading(false));
  };

  const submitPath = (event: FormEvent) => {
    event.preventDefault();
    navigate(path);
  };

  const chooseFolder = async () => {
    if (!result) return;
    setOpening(true);
    setError('');
    try {
      await onOpen(result.path);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="dialog-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="folder-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title">
        <div className="dialog-header">
          <div>
            <div className="dialog-kicker">NEW WORKSPACE</div>
            <h2 id="folder-dialog-title">Choose a folder</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close folder picker"><X size={19} /></Button>
        </div>
        <form className="path-form" onSubmit={submitPath}>
          <div className="path-input-wrap"><Terminal size={15} /><Input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/Users/you/project" aria-label="Folder path" autoFocus /><Button type="submit" variant="ghost" size="sm">Go</Button></div>
        </form>
        {result && (
          <div className="picker-location">
            <Button variant="ghost" size="icon" className="picker-up" onClick={() => result.parentPath && navigate(result.parentPath)} disabled={!result.parentPath} aria-label="Go to parent folder"><ArrowUp size={16} /></Button>
            <div className="location-icon"><Folder size={15} /></div>
            <span title={result.path}>{result.path}</span>
          </div>
        )}
        <div className="folder-list-label"><span>FOLDERS IN THIS LOCATION</span><span>{result?.entries.length ?? 0}</span></div>
        <ScrollArea className="folder-list">
          {loading ? (
            <div className="picker-empty"><Loader2 className="spin" size={20} /><span>Reading folders…</span></div>
          ) : result?.entries.length ? (
            result.entries.map((entry) => (
              <button className="folder-option" key={entry.path} onClick={() => navigate(entry.path)} type="button">
                <Folder size={17} /><span>{entry.name}</span><ChevronRight size={15} className="folder-chevron" />
              </button>
            ))
          ) : (
            <div className="picker-empty"><FolderOpen size={22} /><span>No folders here</span></div>
          )}
        </ScrollArea>
        {error && <div className="inline-error"><AlertCircle size={15} />{error}</div>}
        <div className="dialog-footer">
          <div className="folder-rule"><span className="status-dot" /> folders only</div>
          <div className="dialog-actions"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => void chooseFolder()} disabled={!result || opening}>{opening ? <Loader2 className="spin" size={16} /> : <FolderOpen size={16} />} Open this folder</Button></div>
        </div>
      </section>
    </div>
  );
}

function ExplorerPanel({
  workspace,
  entries,
  allEntries,
  expanded,
  filter,
  onFilter,
  onToggle,
  onFile,
  selectedFile,
  onRefresh,
}: {
  workspace: WorkspaceResult;
  entries: FileEntry[];
  allEntries: Record<string, FileEntry[]>;
  expanded: Record<string, boolean>;
  filter: string;
  onFilter: (value: string) => void;
  onToggle: (entry: FileEntry) => Promise<void>;
  onFile: (entry: FileEntry) => void;
  selectedFile: FileEntry | null;
  onRefresh: () => void;
}) {
  return (
    <aside className="panel explorer-panel">
      <div className="panel-heading">
        <div><div className="panel-kicker">WORKSPACE</div><h2>Explorer</h2></div>
        <div className="panel-heading-actions"><Button variant="ghost" size="icon" onClick={onRefresh} aria-label="Refresh files"><RefreshCw size={15} /></Button></div>
      </div>
      <div className="explorer-root"><FolderOpen size={16} /><span title={workspace.path}>{workspace.name}</span><Badge>{entries.length}</Badge></div>
      <div className="explorer-search"><Search size={14} /><input value={filter} onChange={(event) => onFilter(event.target.value)} placeholder="Filter files" aria-label="Filter files" /></div>
      <ScrollArea className="tree-scroll">
        <div className="file-tree">
          {entries.length ? entries.map((entry) => (
            <TreeRow key={entry.path} entry={entry} depth={0} expanded={expanded} allEntries={allEntries} onToggle={onToggle} onFile={onFile} selectedFile={selectedFile} />
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
  onToggle: (entry: FileEntry) => Promise<void>;
  onFile: (entry: FileEntry) => void;
  selectedFile: FileEntry | null;
}) {
  const isDirectory = entry.kind === 'directory';
  const isOpen = Boolean(expanded[entry.path]);
  return (
    <div className="tree-group">
      <button
        type="button"
        className={cn('tree-row', selectedFile?.path === entry.path && 'tree-row-selected')}
        style={{ paddingLeft: `${10 + depth * 17}px` }}
        onClick={() => isDirectory ? void onToggle(entry) : onFile(entry)}
      >
        {isDirectory ? (isOpen ? <ChevronDown size={14} className="tree-chevron" /> : <ChevronRight size={14} className="tree-chevron" />) : <span className="tree-chevron-spacer" />}
        <EntryIcon entry={entry} open={isOpen} />
        <span className="tree-name">{entry.name}</span>
      </button>
      {isDirectory && isOpen && allEntries[entry.path]?.map((child) => (
        <TreeRow key={child.path} entry={child} depth={depth + 1} expanded={expanded} allEntries={allEntries} onToggle={onToggle} onFile={onFile} selectedFile={selectedFile} />
      ))}
      {isDirectory && isOpen && !allEntries[entry.path] && <div className="tree-loading" style={{ paddingLeft: `${42 + depth * 17}px` }}><Loader2 size={13} className="spin" /> loading</div>}
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

function EditorPanel({
  workspace,
  selectedFile,
  content,
  loading,
  dirty,
  saveState,
  onChange,
  onSave,
  onRefresh,
  onBack,
}: {
  workspace: WorkspaceResult;
  selectedFile: FileEntry | null;
  content: string;
  loading: boolean;
  dirty: boolean;
  saveState: 'saved' | 'saving' | 'error';
  onChange: (value: string) => void;
  onSave: () => void;
  onRefresh: () => void;
  onBack: () => void;
}) {
  const lineCount = Math.max(1, content.split('\n').length);
  const lspExtension = useLspExtension(selectedFile, workspace.path);

  return (
    <section className="panel editor-panel">
      <div className="editor-topline"><Button variant="ghost" size="icon" className="mobile-back" onClick={onBack} aria-label="Back to explorer"><ArrowLeft size={17} /></Button><span className="editor-kicker">EDITOR</span><span className="editor-separator">/</span><span className="editor-root-name">{workspace.name}</span><div className="editor-actions"><Button variant="ghost" size="icon" onClick={onRefresh} disabled={!selectedFile || loading} aria-label="Reload file"><RefreshCw size={15} className={loading ? 'spin' : ''} /></Button><Button variant={dirty ? 'default' : 'ghost'} size="sm" onClick={onSave} disabled={!selectedFile || !dirty || saveState === 'saving'}>{saveState === 'saving' ? <Loader2 size={14} className="spin" /> : <Save size={14} />}<span className="save-label">Save</span></Button></div></div>
      {selectedFile ? (
        <>
          <div className="editor-tabbar"><div className="editor-tab active"><EntryIcon entry={selectedFile} /><span>{selectedFile.name}</span>{dirty && <span className="tab-dirty" />}</div><div className="editor-tab-meta">{fileLanguage(selectedFile.name)}</div></div>
          <div className="editor-breadcrumb"><span>{workspace.name}</span><ChevronRight size={13} /><span>{relativePath(selectedFile.path, workspace.path)}</span>{dirty && <Badge className="unsaved-badge">unsaved</Badge>}</div>
          <div className="code-editor-wrap">
            {loading ? <div className="editor-loading"><Loader2 size={20} className="spin" /><span>Reading file…</span></div> : <CodeEditor value={content} filename={selectedFile.name} reportedLanguage={selectedFile.language} onChange={onChange} onSave={onSave} extraExtensions={lspExtension} />}
          </div>
          <div className="editor-statusbar"><div><Braces size={13} /><span>{selectedFile.language ?? 'plaintext'}</span><span className="statusbar-divider" /><span>{lineCount} lines</span></div><div>{saveState === 'error' ? <span className="save-error"><AlertCircle size={13} /> save failed</span> : saveState === 'saving' ? 'saving…' : dirty ? 'unsaved changes' : <><Check size={13} /> saved</>}</div></div>
        </>
      ) : (
        <EditorWelcome workspace={workspace} />
      )}
    </section>
  );
}

function EditorWelcome({ workspace }: { workspace: WorkspaceResult }) {
  return (
    <div className="editor-welcome"><div className="welcome-mark"><Code2 size={29} /></div><div className="editor-welcome-kicker">WORKSPACE READY</div><h2>Select a file to begin</h2><p>Choose a file from the explorer to read it directly from <strong>{workspace.name}</strong>.</p><div className="welcome-shortcuts"><div><span className="shortcut-icon"><Search size={14} /></span><span>Use the file filter</span></div><div><span className="shortcut-icon"><MessageSquare size={14} /></span><span>Open the Pi agent</span></div></div></div>
  );
}

function AgentPanel({
  workspace,
  messages,
  input,
  busy,
  connection,
  configured,
  adapters,
  activeAdapter,
  onSelectAdapter,
  onInput,
  onSend,
  onSuggestion,
  onBack,
}: {
  workspace: WorkspaceResult;
  messages: ChatMessage[];
  input: string;
  busy: boolean;
  connection: AgentConnection;
  configured: boolean | null;
  adapters: AdapterInfo[];
  activeAdapter: string | null;
  onSelectAdapter: (id: string) => void;
  onInput: (value: string) => void;
  onSend: () => void;
  onSuggestion: (value: string) => void;
  onBack: () => void;
}) {
  const messagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages]);

  const statusLabel = connection === 'thinking' ? 'working' : connection === 'connecting' ? 'connecting' : connection === 'error' ? 'offline' : connection === 'idle' ? 'standby' : 'ready';
  const submit = (event: FormEvent) => { event.preventDefault(); onSend(); };
  const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault(); onSend();
    }
  };

  return (
    <aside className="panel agent-panel">
      <div className="agent-header"><div className="agent-title"><Button variant="ghost" size="icon" className="mobile-back" onClick={onBack} aria-label="Back to explorer"><ArrowLeft size={17} /></Button><div className="agent-avatar"><Bot size={17} /></div><div><div className="panel-kicker">PI / ACP</div><h2>Pi agent</h2></div></div><div className={cn('agent-status', (connection === 'error' || connection === 'idle') && 'agent-status-muted', connection === 'error' && 'agent-status-error')}><span className={cn('status-dot', connection === 'thinking' && 'status-dot-pulse')} />{statusLabel}</div></div>
      <div className="agent-context"><div className="context-icon"><Zap size={14} /></div><div><span className="context-label">WORKING IN</span><strong title={workspace.path}>{workspace.name}</strong></div></div>
      <AdapterPicker adapters={adapters} active={activeAdapter} onSelect={onSelectAdapter} />
      <ScrollArea className="chat-scroll" ref={messagesRef}>
        <div className="chat-messages" aria-live="polite">
          {configured === false && <div className="agent-setup-note"><Terminal size={15} /><div><strong>Pi ACP will start on first message.</strong><span>Make sure <code>pi</code> and a model provider are configured on this machine.</span></div></div>}
          {messages.map((message) => <ChatBubble key={message.id} message={message} />)}
          {busy && messages.every((message) => !message.streaming) && <div className="thinking-row"><span className="thinking-dots"><i /><i /><i /></span> Pi is thinking</div>}
        </div>
      </ScrollArea>
      <div className="agent-compose">
        {messages.length <= 1 && <div className="suggestions"><button type="button" onClick={() => onSuggestion('Give me a quick tour of this workspace')}>Tour this workspace <ArrowUp size={12} /></button><button type="button" onClick={() => onSuggestion('Find the main entry point')}>Find the entry point <ArrowUp size={12} /></button></div>}
        <form className="chat-form" onSubmit={submit}><textarea value={input} onChange={(event) => onInput(event.target.value)} onKeyDown={handleKey} placeholder="Ask Pi anything…" rows={1} aria-label="Message Pi agent" /><Button type="submit" size="icon" disabled={!input.trim() || busy} aria-label="Send message"><Send size={16} /></Button></form>
        <div className="compose-hint"><span>Pi can read and edit files in this workspace</span><span><kbd>↵</kbd> send</span></div>
      </div>
    </aside>
  );
}

// ponytail: a single chip row, not a dropdown — adapters are a small fixed set
// and a segmented control communicates availability at a glance. Missing
// binaries render as muted but still clickable (the backend returns an error
// on chat), so the user knows what's installed without poking around.
function AdapterPicker({ adapters, active, onSelect }: {
  adapters: AdapterInfo[];
  active: string | null;
  onSelect: (id: string) => void;
}) {
  if (adapters.length <= 1) return null;
  return (
    <div className="adapter-picker" role="tablist" aria-label="Adapter">
      {adapters.map((adapter) => (
        <button
          key={adapter.id}
          type="button"
          role="tab"
          aria-selected={adapter.id === active}
          className={cn('adapter-chip', adapter.id === active && 'adapter-chip-active', !adapter.installed && 'adapter-chip-missing')}
          onClick={() => onSelect(adapter.id)}
          title={adapter.installed ? `Use ${adapter.label}` : `${adapter.label} is not installed`}
        >
          {adapter.label}
          {!adapter.installed && <span className="adapter-chip-dot" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'tool') return <div className="tool-message"><div className="tool-icon"><Terminal size={13} /></div><span>{message.text}</span><span className={cn('tool-state', message.toolStatus === 'completed' && 'tool-state-done')}>{message.toolStatus === 'in_progress' ? 'running' : message.toolStatus ?? 'queued'}</span></div>;
  return <div className={cn('chat-bubble-row', message.role === 'user' && 'chat-bubble-row-user')}><div className={cn('chat-bubble', message.role === 'user' ? 'user-bubble' : 'assistant-bubble')}>
    {message.role === 'assistant' && <div className="bubble-label"><Sparkles size={12} /> Pi</div>}
    {message.text ? <div className="bubble-text">{message.text}</div> : message.streaming && <div className="bubble-loading"><span /><span /><span /></div>}
    {message.streaming && <span className="stream-caret" />}
  </div></div>;
}

function MobileNav({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  return <nav className="mobile-nav"><button className={cn(view === 'explorer' && 'active')} onClick={() => onChange('explorer')}><PanelLeft size={18} /><span>Files</span></button><button className={cn(view === 'editor' && 'active')} onClick={() => onChange('editor')}><Code2 size={18} /><span>Editor</span></button><button className={cn(view === 'agent' && 'active')} onClick={() => onChange('agent')}><MessageSquare size={18} /><span>Agent</span></button></nav>;
}
