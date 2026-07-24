export const API_ROOT = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export interface FileEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  size?: number;
  modified?: string;
  language?: string;
}

export interface BrowseResult {
  path: string;
  parentPath: string | null;
  entries: FileEntry[];
}

export interface WorkspaceResult {
  path: string;
  name: string;
  entries: FileEntry[];
}

export interface FileResult {
  path: string;
  content: string;
  language: string;
  size: number;
  modified: string;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${url}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = await response.json();
      message = body.message ?? message;
    } catch {
      // Keep the HTTP status when the server did not return JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function browse(path?: string) {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  return request<BrowseResult>(`/api/fs/browse${query}`);
}

export function openWorkspace(path: string) {
  return request<WorkspaceResult>('/api/workspace', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export function listEntries(path: string) {
  return request<{ path: string; entries: FileEntry[] }>(
    `/api/workspace/entries?path=${encodeURIComponent(path)}`,
  );
}

export function readFile(path: string, workspace: string) {
  return request<FileResult>(
    `/api/file?path=${encodeURIComponent(path)}&workspace=${encodeURIComponent(workspace)}`,
  );
}

export function saveFile(path: string, content: string, workspace: string) {
  return request<FileResult>('/api/file', {
    method: 'PUT',
    body: JSON.stringify({ path, content, workspace }),
  });
}

export interface AdapterInfo {
  id: string;
  label: string;
  installed: boolean;
  active: boolean;
}

export interface AgentStatus {
  configured: boolean;
  sessions: number;
  adapter: string;
  defaultAdapter: string;
  adapters: AdapterInfo[];
}

export function agentStatus(adapter?: string) {
  const query = adapter ? `?adapter=${encodeURIComponent(adapter)}` : '';
  return request<AgentStatus>(`/api/agent/status${query}`);
}

export type AgentEvent =
  | { type: 'status'; status: string; message?: string }
  | { type: 'text'; text: string }
  | { type: 'thought'; text: string }
  | { type: 'tool'; id: string; title: string; status?: string; kind?: string }
  | { type: 'error'; message: string }
  | { type: 'done'; stopReason?: string };

export async function streamAgentMessage(
  workspace: string,
  text: string,
  onEvent: (event: AgentEvent) => void,
  adapter?: string,
): Promise<void> {
  const query = adapter ? `?adapter=${encodeURIComponent(adapter)}` : '';
  const response = await fetch(`${API_ROOT}/api/agent/message${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ workspace, text }),
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = await response.json();
      message = body.message ?? message;
    } catch {
      // Keep the status text.
    }
    throw new Error(message);
  }
  if (!response.body) throw new Error('The agent did not return a stream');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((item) => item.startsWith('data:'));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as AgentEvent);
      } catch {
        // Ignore a malformed heartbeat/frame rather than killing the chat.
      }
    }
    if (done) break;
  }
}

// ---------- Git API ----------

export interface GitRemoteInfo { name: string; fetchUrl: string; pushUrl: string; }
export interface GitBranchInfo { name: string; current: boolean; remote: boolean; upstream?: string; }
export interface GitTagInfo { name: string; hash: string; message?: string; }
export interface GitCommitInfo {
  hash: string; short: string; author: string; email: string; date: string; subject: string;
  body?: string; refs?: string;
}
export interface GitDiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'typechange';
  oldPath?: string;
  additions: number; deletions: number; binary: boolean; diff: string;
}
export interface GitStatus {
  branch: string;
  upstream?: { name: string; ahead: number; behind: number };
  clean: boolean;
  files: GitDiffFile[];
  shortstat: { added: number; modified: number; deleted: number; untracked: number };
}
export interface GitCloneResult { path: string; parent: string; inferred: boolean; }
export interface GitClonePathSuggestion { parent: string; source: 'env' | 'history' | 'home' | 'requested' | 'unnamed'; inferred: string; }

export const git = {
  clone: (url: string, path?: string) =>
    request<GitCloneResult>('/api/git/clone', { method: 'POST', body: JSON.stringify({ url, path }) }),
  suggestClonePath: (name?: string) => {
    const query = name ? `?name=${encodeURIComponent(name)}` : '';
    return request<GitClonePathSuggestion>(`/api/git/clone-path${query}`);
  },
  status: (workspace: string) =>
    request<GitStatus>(`/api/git/status?workspace=${encodeURIComponent(workspace)}`),
  log: (workspace: string, limit = 50) =>
    request<GitCommitInfo[]>(`/api/git/log?workspace=${encodeURIComponent(workspace)}&limit=${limit}`),
  diff: (workspace: string, path?: string, staged = false) => {
    const params = new URLSearchParams({ workspace });
    if (path) params.set('path', path);
    if (staged) params.set('staged', 'true');
    return request<GitDiffFile[]>(`/api/git/diff?${params.toString()}`);
  },
  stage: (workspace: string, paths: string[]) =>
    request<void>('/api/git/stage', { method: 'POST', body: JSON.stringify({ workspace, paths }) }),
  unstage: (workspace: string, paths: string[]) =>
    request<void>('/api/git/unstage', { method: 'POST', body: JSON.stringify({ workspace, paths }) }),
  commit: (workspace: string, message: string, all = false) =>
    request<{ hash: string; short: string }>('/api/git/commit', { method: 'POST', body: JSON.stringify({ workspace, message, all }) }),
  push: (workspace: string, options: { remote?: string; branch?: string; setUpstream?: boolean } = {}) =>
    request<{ stdout: string; stderr: string; exitCode: number }>('/api/git/push', { method: 'POST', body: JSON.stringify({ workspace, ...options }) }),
  pull: (workspace: string, options: { remote?: string; branch?: string } = {}) =>
    request<{ stdout: string; stderr: string; exitCode: number }>('/api/git/pull', { method: 'POST', body: JSON.stringify({ workspace, ...options }) }),
  fetch: (workspace: string, options: { remote?: string; prune?: boolean } = {}) =>
    request<{ stdout: string; stderr: string; exitCode: number }>('/api/git/fetch', { method: 'POST', body: JSON.stringify({ workspace, ...options }) }),
  branches: (workspace: string) =>
    request<GitBranchInfo[]>(`/api/git/branches?workspace=${encodeURIComponent(workspace)}`),
  checkout: (workspace: string, branch: string, create = false) =>
    request<{ stdout: string; stderr: string; exitCode: number }>('/api/git/checkout', { method: 'POST', body: JSON.stringify({ workspace, branch, create }) }),
  deleteBranch: (workspace: string, branch: string, force = false) => {
    const params = new URLSearchParams({ workspace });
    if (force) params.set('force', 'true');
    return request<{ stdout: string; stderr: string; exitCode: number }>(`/api/git/branches/${encodeURIComponent(branch)}?${params.toString()}`, { method: 'DELETE' });
  },
  tags: (workspace: string) =>
    request<GitTagInfo[]>(`/api/git/tags?workspace=${encodeURIComponent(workspace)}`),
  createTag: (workspace: string, name: string, message?: string) =>
    request<{ stdout: string; stderr: string; exitCode: number }>('/api/git/tags', { method: 'PUT', body: JSON.stringify({ workspace, name, message }) }),
  deleteTag: (workspace: string, name: string) =>
    request<{ stdout: string; stderr: string; exitCode: number }>(`/api/git/tags/${encodeURIComponent(name)}?workspace=${encodeURIComponent(workspace)}`, { method: 'DELETE' }),
  remotes: (workspace: string) =>
    request<GitRemoteInfo[]>(`/api/git/remotes?workspace=${encodeURIComponent(workspace)}`),
  addRemote: (workspace: string, name: string, url: string) =>
    request<{ stdout: string; stderr: string; exitCode: number }>('/api/git/remotes', { method: 'POST', body: JSON.stringify({ workspace, name, url }) }),
  removeRemote: (workspace: string, name: string) =>
    request<{ stdout: string; stderr: string; exitCode: number }>(`/api/git/remotes/${encodeURIComponent(name)}?workspace=${encodeURIComponent(workspace)}`, { method: 'DELETE' }),
  setRemoteUrl: (workspace: string, name: string, url: string) =>
    request<{ stdout: string; stderr: string; exitCode: number }>(`/api/git/remotes/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify({ workspace, url }) }),
};