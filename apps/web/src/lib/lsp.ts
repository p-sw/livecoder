import { useEffect, useMemo, useRef, useState } from 'react';
import type { Extension } from '@codemirror/state';
import { LSPClient, type Transport, languageServerExtensions } from '@codemirror/lsp-client';
import { detectLanguage } from './languages';

interface FileRef {
  name: string;
  path: string;
  language?: string;
}

type LspStatus = 'connecting' | 'ready' | 'error' | 'idle';

// ponytail: one LSP client per language — most editors (vscode, codium) do the
// same so completions and diagnostics stay coherent within a session. The
// client survives file switches; only the file URI/plugin changes.
interface ClientSlot {
  client: LSPClient;
  transport: WebSocketTransport;
  refCount: number;
}

const clients = new Map<string, ClientSlot>();

// ponytail: the @codemirror/lsp-client Transport interface is intentionally
// tiny — `{ send, subscribe, unsubscribe }` over JSON strings. A WebSocket fits
// verbatim. Lifecycle is owned here so re-opening the editor reuses the
// existing server instead of spawning another.
class WebSocketTransport implements Transport {
  private handlers = new Set<(value: string) => void>();
  private socket: WebSocket | null = null;

  constructor(private readonly url: string) {}

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error(`LSP WebSocket failed: ${this.url}`));
      // ponytail: on server-side close the socket enters a non-OPEN state
      // and subsequent sends become silent no-ops; requests then time out
      // without the client knowing. Drop the reference so the next acquire
      // creates a fresh transport instead of reusing a dead one.
      socket.onclose = () => { this.socket = null };
      socket.onmessage = (event) => {
        const data = typeof event.data === 'string' ? event.data : '';
        for (const handler of this.handlers) handler(data);
      };
    });
  }

  send(message: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(message);
  }

  subscribe(handler: (value: string) => void): void {
    this.handlers.add(handler);
  }

  unsubscribe(handler: (value: string) => void): void {
    this.handlers.delete(handler);
  }

  close(): void {
    this.handlers.clear();
    this.socket?.close();
    this.socket = null;
  }
}

// ponytail: server tells us which language IDs it can host an LSP for. The
// WebSocket URL carries the language via query string so a single endpoint
// can route to different spawned servers.
function lspUrl(languageId: string, workspace: string, filePath: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({
    language: languageId,
    workspace,
    file: filePath,
  });
  return `${proto}//${window.location.host}/api/lsp?${params.toString()}`;
}

export function useLspExtension(file: FileRef | null, workspacePath: string | undefined): Extension[] {
  const [status, setStatus] = useState<LspStatus>('idle');
  const statusRef = useRef(status);
  statusRef.current = status;

  const languageId = useMemo(() => {
    if (!file) return null;
    return detectLanguage(file.name, file.language).id;
  }, [file?.name, file?.language]);

  const slotKey = languageId ?? '__none__';

  useEffect(() => {
    if (!file || !workspacePath || !languageId) {
      setStatus('idle');
      return;
    }

    let cancelled = false;

    const acquire = async () => {
      let slot = clients.get(slotKey);
      if (!slot) {
        const transport = new WebSocketTransport(lspUrl(languageId, workspacePath, file.path));
        const client = new LSPClient({
          rootUri: pathToFileUri(workspacePath),
          extensions: languageServerExtensions(),
          // ponytail: 30s — default 3s is too tight for TS type analysis
          // over a proxied WebSocket (Cloudflare buffers frames).
          timeout: 30000,
        });
        try {
          await transport.open();
        } catch {
          if (!cancelled) setStatus('error');
          return;
        }
        if (cancelled) {
          transport.close();
          return;
        }
        slot = { client, transport, refCount: 0 };
        client.connect({
          send: (m) => transport.send(m),
          subscribe: (h) => transport.subscribe(h),
          unsubscribe: (h) => transport.unsubscribe(h),
        });
        clients.set(slotKey, slot);
      }

      if (cancelled) return;
      slot.refCount += 1;
      setStatus('ready');
    };

    void acquire();

    return () => {
      cancelled = true;
      const slot = clients.get(slotKey);
      if (slot) {
        slot.refCount -= 1;
        if (slot.refCount <= 0) {
          slot.client.disconnect();
          slot.transport.close();
          clients.delete(slotKey);
        }
      }
    };
  }, [slotKey, languageId, workspacePath, file?.path]);

  return useMemo<Extension[]>(() => {

    if (!file || !languageId) return [];
    const slot = clients.get(slotKey);
    if (!slot) return [];
    const uri = pathToFileUri(file.path);
    return [slot.client.plugin(uri, languageId)];
  }, [slotKey, languageId, file?.path, status]);
}

// ponytail: convert an absolute filesystem path to a file:// URI as LSP
// requires. Cross-platform: handles Windows drive letters and normalizes
// separators.
function pathToFileUri(absolutePath: string): string {
  const isWindows = /^[a-zA-Z]:[\\/]/.test(absolutePath);
  let normalized = absolutePath.replace(/\\/g, '/');
  if (isWindows) {
    normalized = `/${normalized}`;
  }
  const encoded = normalized
    .split('/')
    .map((segment, index) => (index === 0 && isWindows ? segment : encodeURIComponent(segment)))
    .join('/');
  return `file://${encoded}`;
}
