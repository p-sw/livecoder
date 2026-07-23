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

export function agentStatus() {
  return request<{ configured: boolean; sessions: number; adapter: string }>('/api/agent/status');
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
): Promise<void> {
  const response = await fetch(`${API_ROOT}/api/agent/message`, {
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
