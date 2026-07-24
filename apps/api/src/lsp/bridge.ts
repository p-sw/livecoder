import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import type { Duplex } from 'node:stream';
import type { Server as NodeHttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { findLspServer, type LspServerSpec } from './servers.js';

interface SpawnedServer {
  child: ChildProcessWithoutNullStreams;
  buffer: Buffer;
  send: (payload: string) => void;
  close: () => void;
}

// ponytail: an LSP child speaks Content-Length framed JSON-RPC on stdio.
// This strips/rewrites that framing so the WebSocket peer can pass plain JSON
// (which is what @codemirror/lsp-client expects).
function createServerProcess(spec: LspServerSpec, cwd: string): SpawnedServer | null {
  const command = resolveCommand(spec, cwd);
  if (!command) return null;
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(command, spec.args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return null;
  }

  child.on('error', () => { /* handled by the caller */ });

  const send = (payload: string) => {
    const body = Buffer.from(payload, 'utf8');
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8');
    child.stdin.write(Buffer.concat([header, body]));
  };

  const close = () => {
    if (!child.killed) child.kill('SIGTERM');
  };

  return { child, buffer: Buffer.alloc(0), send, close };
}

function resolveCommand(spec: LspServerSpec, cwd: string): string | null {
  // ponytail: the local install in the workspace's node_modules wins —
  // pinned versions beat whatever happens to be on PATH. The workspace
  // cwd is the file root the user opened, so its node_modules/.bin is
  // where project-scoped LSP servers land. Bare name is the last resort
  // so spawn() can do its own PATH lookup.
  const local = join(cwd, 'node_modules', '.bin', spec.command);
  if (existsSync(local)) return local;
  if (existsSync(spec.command)) return spec.command;
  return spec.command;
}

// ponytail: one child per language per workspace — most LSP servers handle
// multi-file gracefully, and this avoids paying the startup cost per open.
const sessions = new Map<string, SpawnedServer>();

function sessionKey(language: string, workspace: string): string {
  return `${language}::${workspace}`;
}

async function getOrCreateSession(language: string, workspace: string): Promise<SpawnedServer | null> {
  const key = sessionKey(language, workspace);
  const existing = sessions.get(key);
  if (existing) return existing;

  const spec = findLspServer(language);
  if (!spec) return null;

  const server = createServerProcess(spec, workspace);
  if (!server) return null;

  // ponytail: wait for spawn before declaring the session ready so we don't
  // forward messages into a closed pipe.
  const { promise, resolve, reject } = Promise.withResolvers<ChildProcessWithoutNullStreams>();
  server.child.once('spawn', () => resolve(server.child));
  server.child.once('error', reject);
  try {
    const child = await promise;
    sessions.set(key, { ...server, child });
  } catch {
    return null;
  }
  return sessions.get(key) ?? null;
}

interface LspConnectionParams {
  language: string;
  workspace: string;
  file: string;
}

// ponytail: handle one WebSocket connection. We never trust the peer — the
// workspace path is resolved against the api process's filesystem, and we
// refuse languages we don't have a server for.
export function handleLspConnection(socket: WebSocket, params: LspConnectionParams): void {
  const { language, workspace } = params;
  const sendError = (id: number | null, message: string): void => {
    const payload = {
      jsonrpc: '2.0',
      id: id ?? 0,
      error: { code: -32000, message },
    };
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
  };

  void (async () => {
    const session = await getOrCreateSession(language, resolvePath(workspace));
    if (!session) {
      sendError(null, `No LSP server available for language: ${language}`);
      socket.close(1011, 'LSP server unavailable');
      return;
    }

    socket.on('message', (data) => {
      try {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        session.send(text);
      } catch {
        sendError(null, 'Failed to forward message to LSP server');
      }
    });

    const onStdout = (chunk: Buffer) => {
      // ponytail: the LSP server may emit messages back-to-back; the buffer
      // carries incomplete frames between calls.
      session.buffer = Buffer.concat([session.buffer, chunk]);
      let headerEnd: number;
      while ((headerEnd = session.buffer.indexOf('\r\n\r\n')) !== -1) {
        const headerText = session.buffer.subarray(0, headerEnd).toString('ascii');
        const length = parseContentLength(headerText);
        if (length === null) {
          // ponytail: malformed frame — drop everything up to the separator
          // and try again rather than wedging the connection.
          session.buffer = session.buffer.subarray(headerEnd + 4);
          continue;
        }
        const totalLength = headerEnd + 4 + length;
        if (session.buffer.length < totalLength) break;
        const body = session.buffer.subarray(headerEnd + 4, totalLength);
        if (socket.readyState === socket.OPEN) socket.send(body.toString('utf8'));
        session.buffer = session.buffer.subarray(totalLength);
      }
    };
    session.child.stdout.on('data', onStdout);

    const onStderr = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (text.trim()) process.stderr.write(`[lsp:${language}] ${text}`);
    };
    session.child.stderr.on('data', onStderr);

    const onChildExit = () => {
      if (socket.readyState === socket.OPEN) socket.close(1011, 'LSP server exited');
      const key = sessionKey(language, workspace);
      if (sessions.get(key) === session) sessions.delete(key);
    };
    session.child.once('exit', onChildExit);

    socket.once('close', () => {
      session.child.stdout.off('data', onStdout);
      session.child.stderr.off('data', onStderr);
      session.child.off('exit', onChildExit);
      // ponytail: keep the session alive across WS closes — other files
      // opened next will reuse it. Drop only when the child exits.
    });
  })();
}

function parseContentLength(header: string): number | null {
  const match = header.match(/Content-Length:\s*(\d+)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

// ponytail: attach a WebSocketServer to the existing HTTP server's `upgrade`
// event. Keeping it inside the NestJS bootstrap means the WS lifecycle is
// owned by the api process.
export function attachLspWebSocket(server: NodeHttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    if (!request.url) return;
    const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/api/lsp') return;

    wss.handleUpgrade(request, socket as Duplex, head, (ws) => {
      const language = url.searchParams.get('language') ?? '';
      const workspace = url.searchParams.get('workspace') ?? '';
      const file = url.searchParams.get('file') ?? '';
      if (!language || !workspace) {
        ws.close(1008, 'Missing language or workspace query parameter');
        return;
      }
      handleLspConnection(ws, { language, workspace, file });
    });
  });

  return wss;
}

// ponytail: typed handle for the api bootstrap. The `Server` import from
// node:http is referenced by the consumer (`app.getHttpServer()` returns it).
export type LspWebSocketServer = WebSocketServer;
