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
import { readWorkspaceFromUrl, routeWithWorkspace } from './router';
import {
  agentSessions,
  agentStatus,
  listEntries,
  openWorkspace,
  readFile,
  saveFile,
  streamAgentMessage,
  API_ROOT,
  type AgentEvent,
  type FileEntry,
  type SessionInfo,
  type WorkspaceResult,
} from './api';


// ponytail: recent workspaces are just path+name in localStorage — no server.
const RECENT_KEY = 'livecoder.workspaces';

export interface RecentWorkspace {
  path: string;
  name: string;
}

function readRecent(): RecentWorkspace[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RecentWorkspace =>
        !!item && typeof item === 'object' && typeof (item as RecentWorkspace).path === 'string' && typeof (item as RecentWorkspace).name === 'string',
    );
  } catch {
    return [];
  }
}

function rememberWorkspace(ws: RecentWorkspace): RecentWorkspace[] {
  const next = [ws, ...readRecent().filter((item) => item.path !== ws.path)].slice(0, 12);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}
type AgentConnection = 'idle' | 'connecting' | 'ready' | 'thinking' | 'error';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'thought';
  text: string;
  toolId?: string;
  toolStatus?: string;
  toolDetail?: string;
  streaming?: boolean;
}

// ponytail: one reducer for live stream + session replay so reload keeps
// multi-bubble tool/thought splits instead of collapsing to one text blob.
type BubbleCursor = {
  activeId: string | null;
  activeMessageId: string | undefined;
  activeRole: 'assistant' | 'thought' | null;
};

function newBubbleCursor(): BubbleCursor {
  return { activeId: null, activeMessageId: undefined, activeRole: null };
}

function finishActiveBubble(messages: ChatMessage[], cursor: BubbleCursor): ChatMessage[] {
  if (!cursor.activeId) return messages;
  const id = cursor.activeId;
  cursor.activeId = null;
  cursor.activeMessageId = undefined;
  cursor.activeRole = null;
  return messages.map((message) => (message.id === id && message.streaming ? { ...message, streaming: false } : message));
}

function appendRoleBubble(
  messages: ChatMessage[],
  cursor: BubbleCursor,
  role: 'assistant' | 'thought',
  chunk: string,
  messageId: string | undefined,
  streaming: boolean,
): ChatMessage[] {
  const sameMessage = !messageId || !cursor.activeMessageId || cursor.activeMessageId === messageId;
  if (cursor.activeId && cursor.activeRole === role && sameMessage) {
    if (messageId) cursor.activeMessageId = messageId;
    const id = cursor.activeId;
    return messages.map((message) => (
      message.id === id ? { ...message, text: `${message.text}${chunk}`, streaming } : message
    ));
  }
  let next = finishActiveBubble(messages, cursor);
  const id = `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  cursor.activeId = id;
  cursor.activeMessageId = messageId;
  cursor.activeRole = role;
  return [...next, { id, role, text: chunk, streaming }];
}

function upsertToolBubble(messages: ChatMessage[], cursor: BubbleCursor, event: Extract<AgentEvent, { type: 'tool' }>): ChatMessage[] {
  let next = finishActiveBubble(messages, cursor);
  const found = next.some((message) => message.toolId === event.id);
  if (found) {
    return next.map((message) => message.toolId === event.id
      ? {
          ...message,
          text: event.title ?? message.text,
          toolStatus: event.status ?? message.toolStatus,
          toolDetail: event.detail ?? message.toolDetail,
        }
      : message);
  }
  return [...next, {
    id: `tool-${event.id}`,
    role: 'tool' as const,
    text: event.title ?? 'Tool',
    toolId: event.id,
    toolStatus: event.status,
    toolDetail: event.detail,
  }];
}

function applyChatEvent(
  messages: ChatMessage[],
  cursor: BubbleCursor,
  event: AgentEvent,
  streaming: boolean,
): ChatMessage[] {
  if (event.type === 'text') return appendRoleBubble(messages, cursor, 'assistant', event.text, event.messageId, streaming);
  if (event.type === 'thought') return appendRoleBubble(messages, cursor, 'thought', event.text, event.messageId, streaming);
  if (event.type === 'tool') return upsertToolBubble(messages, cursor, event);
  if (event.type === 'error') return appendRoleBubble(messages, cursor, 'assistant', `\n\n${event.message}`, undefined, streaming);
  if (event.type === 'done') return finishActiveBubble(messages, cursor);
  return messages;
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
  recentWorkspaces: RecentWorkspace[];
  loadWorkspace: (path: string) => Promise<void>;

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
  editFileContent: (content: string) => void;
  visibleEntries: FileEntry[];

  chatMessages: ChatMessage[];
  chatInput: string;
  agentConnection: AgentConnection;
  agentConfigured: boolean | null;
  agentBusy: boolean;
  activeAdapter: string | null;
  agentSessionsList: SessionInfo[];
  activeSessionId: string | null;
  setChatInput: (value: string) => void;
  sendChat: (value?: string) => Promise<void>;
  newAgentSession: () => Promise<void>;
  loadAgentSession: (sessionId: string) => Promise<void>;
  closeAgentSession: (sessionId?: string) => Promise<void>;
  refreshAgentSessions: () => Promise<void>;
}

const StoreContext = createContext<WorkspaceStore | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<WorkspaceResult | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>(() => readRecent());
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [entries, setEntries] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState('');
  const [fileContent, setFileContentState] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileDirty, setFileDirty] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [chatInput, setChatInput] = useState('');
  const [agentConnection, setAgentConnection] = useState<AgentConnection>('idle');
  const [agentConfigured, setAgentConfigured] = useState<boolean | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [activeAdapter, setActiveAdapter] = useState<string | null>(null);
  const [agentSessionsList, setAgentSessionsList] = useState<SessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

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
    const url = new URL(window.location.href);
    url.searchParams.set('workspace', result.path);
    window.history.replaceState(window.history.state, '', url);
    setWorkspace(result);
    setRecentWorkspaces(rememberWorkspace({ path: result.path, name: result.name }));
    setEntries({ [result.path]: result.entries });
    setExpanded({});
    setFilter('');
    setFileContentState('');
    setFileDirty(false);
    setSaveState('saved');
    setChatMessages([WELCOME_MESSAGE]);
    setAgentConfigured(null);
    setAgentConnection('idle');
    setAgentSessionsList([]);
    setActiveSessionId(null);
    setPickerOpen(false);
  }, [fileDirty]);

  // ponytail: silent workspace load — same as openFolder but skips the
  // dirty-confirm prompt. Used for the initial URL-driven restore and
  // for in-app re-mounts where the user has not asked to discard work.
  const loadWorkspace = useCallback(async (path: string) => {
    const result = await openWorkspace(path);
    setWorkspace(result);
    setRecentWorkspaces(rememberWorkspace({ path: result.path, name: result.name }));
    setEntries({ [result.path]: result.entries });
    setExpanded({});
    setFilter('');
    setFileContentState('');
    setFileDirty(false);
    setSaveState('saved');
    setChatMessages([WELCOME_MESSAGE]);
    setAgentConfigured(null);
    setAgentConnection('idle');
    setAgentSessionsList([]);
    setActiveSessionId(null);
    setPickerOpen(false);
  }, []);

  // ponytail: restore the workspace from ?workspace=<path> on hard reload.
  // Skips the dirty-confirm because a reload doesn't carry that intent.
  useEffect(() => {
    const target = readWorkspaceFromUrl();
    if (target && target !== workspace?.path) {
      void loadWorkspace(target).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ponytail: react to URL changes (back/forward, programmatic nav) so the
  // workspace stays in sync with whatever ?workspace currently points at.
  useEffect(() => {
    const sync = () => {
      const target = readWorkspaceFromUrl();
      if (!target || target === workspace?.path) return;
      void loadWorkspace(target).catch(() => undefined);
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [loadWorkspace, workspace?.path]);

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
      setFileContentState(result.content);
    } catch (error) {
      if (requestId !== fileRequest.current) return;
      setFileContentState(`Unable to open this file.\n\n${error instanceof Error ? error.message : String(error)}`);
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

  // ponytail: loaders and the file watcher call this — the on-disk buffer
  // is authoritative, so dirty state must NOT flip when content is replaced.
  const setFileContent = useCallback((content: string) => {
    setFileContentState(content);
  }, []);

  // ponytail: typing into the editor marks the file dirty. Done as a
  // single store mutation so the Save button + unsaved indicator update
  // in the same render pass as the doc change.
  const editFileContent = useCallback((content: string) => {
    setFileContentState(content);
    setFileDirty(true);
    setSaveState((current) => (current === 'error' ? 'saved' : current));
  }, []);

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
      setFileContentState(result.content);
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
            setFileContentState(result.content);
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
        setActiveAdapter(result.adapter);
        setActiveSessionId(result.activeSessionId);
      })
      .catch(() => setAgentConfigured(false));
  }, [workspace]);

  const refreshAgentSessions = useCallback(async () => {
    if (!workspace) return;
    try {
      const result = await agentSessions.list(workspace.path);
      setAgentSessionsList(result.sessions);
      setActiveSessionId(result.activeSessionId);
      setActiveAdapter(result.adapter);
    } catch {
      // Runtime may not be up yet — empty list is fine.
      setAgentSessionsList([]);
    }
  }, [workspace]);

  const sendChat = useCallback(async (value?: string) => {
    const text = (value ?? chatInput).trim();
    if (!text || agentBusy || !workspace) return;
    setChatInput('');
    setChatMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: 'user', text },
    ]);
    setAgentBusy(true);
    setAgentConnection('connecting');

    const cursor = newBubbleCursor();
    const handleEvent = (event: AgentEvent) => {
      if (event.type === 'status') {
        setAgentConnection(event.status === 'thinking' ? 'thinking' : event.status === 'connecting' ? 'connecting' : 'ready');
      }
      if (event.type === 'session') setActiveSessionId(event.sessionId);
      if (event.type === 'error') setAgentConnection('error');
      setChatMessages((current) => applyChatEvent(current, cursor, event, true));
    };
    try {
      const context = selectedFile ? `\n\nThe user is currently viewing ${relativePath(selectedFile.path, workspace.path)}.` : '';
      await streamAgentMessage(workspace.path, `${text}${context}`, handleEvent, activeSessionId ?? undefined);
      void refreshAgentSessions();
    } catch (error) {
      setChatMessages((current) => applyChatEvent(
        current,
        cursor,
        { type: 'error', message: `Unable to reach agent ACP. ${error instanceof Error ? error.message : String(error)}` },
        true,
      ));
      setAgentConnection('error');
    } finally {
      setChatMessages((current) => finishActiveBubble(current, cursor));
      setAgentBusy(false);
    }
  }, [agentBusy, chatInput, selectedFile, workspace, activeSessionId, refreshAgentSessions]);

  const newAgentSession = useCallback(async () => {
    if (!workspace || agentBusy) return;
    setAgentBusy(true);
    setChatMessages([WELCOME_MESSAGE]);
    setAgentConnection('connecting');
    try {
      await agentSessions.create(workspace.path, (event) => {
        if (event.type === 'session') setActiveSessionId(event.sessionId);
        if (event.type === 'status') {
          setAgentConnection(event.status === 'connecting' ? 'connecting' : 'ready');
        }
        if (event.type === 'error') setAgentConnection('error');
      });
      setAgentConnection('ready');
      void refreshAgentSessions();
    } catch (error) {
      setAgentConnection('error');
      setChatMessages([{
        id: `error-${Date.now()}`,
        role: 'assistant',
        text: `Could not create session. ${error instanceof Error ? error.message : String(error)}`,
      }]);
    } finally {
      setAgentBusy(false);
    }
  }, [workspace, agentBusy, refreshAgentSessions]);

  const loadAgentSession = useCallback(async (sessionId: string) => {
    if (!workspace || agentBusy) return;
    setAgentBusy(true);
    setChatMessages([]);
    setAgentConnection('connecting');
    let history: ChatMessage[] = [];
    const cursor = newBubbleCursor();
    try {
      await agentSessions.load(workspace.path, sessionId, (event) => {
        if (event.type === 'history') {
          history = finishActiveBubble(history, cursor);
          const last = history[history.length - 1];
          if (last?.role === 'user') {
            history = history.map((message, index) => (
              index === history.length - 1 ? { ...message, text: message.text + event.text } : message
            ));
          } else {
            history = [...history, { id: `user-${history.length}`, role: 'user', text: event.text }];
          }
          setChatMessages(history);
          return;
        }
        if (event.type === 'session') setActiveSessionId(event.sessionId);
        if (event.type === 'status') {
          setAgentConnection(event.status === 'connecting' ? 'connecting' : 'ready');
        }
        if (event.type === 'error') setAgentConnection('error');
        history = applyChatEvent(history, cursor, event, false);
        setChatMessages(history);
      });
      history = finishActiveBubble(history, cursor);
      setChatMessages(history.length === 0 ? [WELCOME_MESSAGE] : history);
      setActiveSessionId(sessionId);
      setAgentConnection('ready');
      void refreshAgentSessions();
    } catch (error) {
      setAgentConnection('error');
      setChatMessages([{
        id: `error-${Date.now()}`,
        role: 'assistant',
        text: `Could not load session. ${error instanceof Error ? error.message : String(error)}`,
      }]);
    } finally {
      setAgentBusy(false);
    }
  }, [workspace, agentBusy, refreshAgentSessions]);

  // ponytail: close = drop ACP session + local chat; next message spins a new one
  const closeAgentSession = useCallback(async (sessionId?: string) => {
    if (!workspace || agentBusy) return;
    const id = sessionId ?? activeSessionId;
    if (!id) {
      setChatMessages([WELCOME_MESSAGE]);
      return;
    }
    setAgentBusy(true);
    try {
      await agentSessions.close(workspace.path, id);
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setChatMessages([WELCOME_MESSAGE]);
      }
      await refreshAgentSessions();
    } catch (error) {
      setChatMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          text: `Could not delete session. ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    } finally {
      setAgentBusy(false);
    }
  }, [workspace, agentBusy, activeSessionId, refreshAgentSessions]);

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
    recentWorkspaces,
    loadWorkspace,
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
    editFileContent,
    visibleEntries,
    chatMessages,
    chatInput,
    agentConnection,
    agentConfigured,
    agentBusy,
    activeAdapter,
    agentSessionsList,
    activeSessionId,
    setChatInput,
    sendChat,
    newAgentSession,
    loadAgentSession,
    closeAgentSession,
    refreshAgentSessions,
  };

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useWorkspaceStore(): WorkspaceStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useWorkspaceStore must be used inside <WorkspaceProvider>');
  return store;
}
