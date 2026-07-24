// ponytail: workspace state lifted into a React context so each route
// (editor, agent, git, files) can consume the same data without prop
// drilling. App.tsx used to be the single owner; splitting into routes
// forced the move.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { relativePath } from './lib/utils';
import {
  agentStatus,
  listEntries,
  openWorkspace,
  readFile,
  saveFile,
  streamAgentMessage,
  API_ROOT,
  type AdapterInfo,
  type AgentEvent,
  type FileEntry,
  type WorkspaceResult,
} from './api';

type AgentConnection = 'idle' | 'connecting' | 'ready' | 'thinking' | 'error';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  toolId?: string;
  toolStatus?: string;
  streaming?: boolean;
}

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  text: 'I’m ready to work in this workspace. Ask me to explore the code, explain a file, or make a change.',
};

export interface WorkspaceStore {
  workspace: WorkspaceResult | null;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  openFolder: (path: string) => Promise<void>;

  selectedFile: FileEntry | null;
  entries: Record<string, FileEntry[]>;
  expanded: Record<string, boolean>;
  filter: string;
  fileContent: string;
  fileLoading: boolean;
  fileDirty: boolean;
  saveState: 'saved' | 'saving' | 'error';
  loadFile: (entry: FileEntry, root: string) => Promise<void>;
  toggleDirectory: (entry: FileEntry) => Promise<void>;
  refreshDirectory: (path: string) => Promise<void>;
  saveCurrentFile: () => Promise<void>;
  reloadCurrentFile: () => Promise<void>;
  setFilter: (filter: string) => void;
  setFileContent: (content: string) => void;
  visibleEntries: FileEntry[];

  chatMessages: ChatMessage[];
  chatInput: string;
  agentConnection: AgentConnection;
  agentConfigured: boolean | null;
  agentBusy: boolean;
  adapters: AdapterInfo[];
  activeAdapter: string | null;
  setChatInput: (value: string) => void;
  setActiveAdapter: (id: string) => void;
  sendChat: (value?: string) => Promise<void>;
}

const StoreContext = createContext<WorkspaceStore | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<WorkspaceResult | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
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

  useEffect(() => { selectedRef.current = selectedFile; }, [selectedFile]);
  useEffect(() => { dirtyRef.current = fileDirty; }, [fileDirty]);

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
  }, [fileDirty]);

  const loadFile = useCallback(async (entry: FileEntry, root: string) => {
    if (fileDirty && selectedFile?.path !== entry.path && !window.confirm('Discard unsaved changes and open another file?')) return;
    const requestId = ++fileRequest.current;
    setSelectedFile(entry);
    setFileLoading(true);
    setFileDirty(false);
    setSaveState('saved');
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
    if (expanded[entry.path]) {
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
    if (!workspace) return;
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

  const store: WorkspaceStore = {
    workspace,
    pickerOpen,
    setPickerOpen,
    openFolder,
    selectedFile,
    entries,
    expanded,
    filter,
    fileContent,
    fileLoading,
    fileDirty,
    saveState,
    loadFile,
    toggleDirectory,
    refreshDirectory,
    saveCurrentFile,
    reloadCurrentFile,
    setFilter,
    setFileContent,
    visibleEntries,
    chatMessages,
    chatInput,
    agentConnection,
    agentConfigured,
    agentBusy,
    adapters,
    activeAdapter,
    setChatInput,
    setActiveAdapter,
    sendChat,
  };

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useWorkspaceStore(): WorkspaceStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useWorkspaceStore must be used inside <WorkspaceProvider>');
  return store;
}
