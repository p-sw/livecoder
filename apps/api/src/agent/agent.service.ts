import { Injectable, OnModuleDestroy } from '@nestjs/common';
import * as acp from '@agentclientprotocol/sdk';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import {
  adapterInstalled,
  defaultAdapterId,
  defaultAdapterSource,
  listAdapters,
  resolveAdapter,
  resolveAdapterCommand,
  type AdapterSpec,
} from './adapter-registry.js';

export type AgentEvent =
  | { type: 'status'; status: 'connecting' | 'ready' | 'thinking' | 'complete'; message?: string }
  | { type: 'text'; text: string }
  | { type: 'thought'; text: string }
  | { type: 'tool'; id: string; title: string; status?: string; kind?: string }
  | { type: 'error'; message: string }
  | { type: 'done'; stopReason?: string };

type Emit = (event: AgentEvent) => void;
type QueueItem =
  | { kind: 'notification'; value: acp.SessionNotification }
  | { kind: 'stop'; value: acp.PromptResponse }
  | { kind: 'error'; value: unknown };

export interface AdapterDescriptor {
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
  defaultAdapterSource: 'settings' | 'env' | 'builtin';
  adapters: AdapterDescriptor[];
}

@Injectable()
export class AgentService implements OnModuleDestroy {
  // ponytail: one session per (adapter, workspace) pair. Switching adapters
  // mid-session is supported because the workspace key stays stable and
  // each adapter holds its own long-lived AcpSession.
  private readonly sessions = new Map<string, Promise<AcpSession>>();

  async prompt(workspace: string, text: string, emit: Emit, adapterId?: string): Promise<void> {
    const adapter = this.resolveAdapter(adapterId);
    const key = `${adapter.id}::${workspace}`;
    let sessionPromise = this.sessions.get(key);
    if (!sessionPromise) {
      sessionPromise = AcpSession.start(workspace, emit, adapter);
      this.sessions.set(key, sessionPromise);
      sessionPromise.catch(() => this.sessions.delete(key));
    }
    const session = await sessionPromise;
    try {
      await session.prompt(text, emit);
    } catch (error) {
      if (this.sessions.get(key) === sessionPromise) this.sessions.delete(key);
      void session.close().catch(() => undefined);
      throw error;
    }
  }

  status(adapterId?: string): AgentStatus {
    const adapter = this.resolveAdapter(adapterId);
    const installed = adapterInstalled(adapter);
    return {
      configured: installed,
      sessions: this.sessions.size,
      adapter: adapter.id,
      defaultAdapter: defaultAdapterId(),
      defaultAdapterSource: defaultAdapterSource(),
      adapters: listAdapters().map((spec) => ({
        id: spec.id,
        label: spec.label,
        installed: adapterInstalled(spec),
        active: spec.id === adapter.id,
      })),
    };
  }

  private resolveAdapter(adapterId?: string): AdapterSpec {
    const resolved = resolveAdapter(adapterId ?? '');
    // ponytail: requested adapter missing → fall back to default. The chat
    // endpoint surfaces a friendly error if even the default is missing.
    if (resolved) return resolved;
    const fallback = resolveAdapter(defaultAdapterId());
    if (fallback) return fallback;
    return { id: 'pi', label: 'Pi', command: 'pi-acp', args: [] };
  }

  async onModuleDestroy(): Promise<void> {
    const sessions = await Promise.allSettled(this.sessions.values());
    await Promise.all(
      sessions.flatMap((result) => (result.status === 'fulfilled' ? [result.value.close()] : [])),
    );
  }
}

class AcpSession {
  private queue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly connection: acp.ClientSideConnection,
    private readonly sessionId: string,
    private readonly updates: AsyncQueue<QueueItem>,
  ) {}

  static async start(cwd: string, emit: Emit, adapter: AdapterSpec): Promise<AcpSession> {
    emit({ type: 'status', status: 'connecting', message: `Starting ${adapter.label}…` });
    const { command, args } = resolveAdapterCommand(adapter);
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4000);
    });
    await waitForSpawn(child);

    const updates = new AsyncQueue<QueueItem>();
    const client: acp.Client = {
      requestPermission: async (params) => {
        const option = params.options.find((item) => item.kind === 'allow_once')
          ?? params.options.find((item) => item.kind === 'allow_always')
          ?? params.options[0];
        if (!option) return { outcome: { outcome: 'cancelled' } };
        return { outcome: { outcome: 'selected', optionId: option.optionId } };
      },
      sessionUpdate: async (params) => {
        updates.push({ kind: 'notification', value: params });
      },
      readTextFile: async (params) => {
        const value = await fs.readFile(params.path, 'utf8');
        const lines = value.split(/\r?\n/);
        const start = Math.max(0, (params.line ?? 1) - 1);
        const end = params.limit ? start + params.limit : lines.length;
        return { content: lines.slice(start, end).join('\n') };
      },
      writeTextFile: async (params) => {
        await fs.writeFile(params.path, params.content, 'utf8');
        return {};
      },
    };

    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
    );
    const connection = new acp.ClientSideConnection(() => client, stream);
    void connection.closed.then(() => {
      updates.push({ kind: 'error', value: new Error(`${adapter.label} connection closed`) });
    });

    try {
      await connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientInfo: { name: 'livecoder', title: 'livecoder', version: '0.1.0' },
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });
      const session = await connection.newSession({ cwd, mcpServers: [] });
      emit({ type: 'status', status: 'ready', message: `${adapter.label} is ready` });
      return new AcpSession(child, connection, session.sessionId, updates);
    } catch (error) {
      child.kill();
      const detail = error instanceof Error ? error.message : String(error);
      const suffix = stderr.trim() ? ` — ${stderr.trim().split('\n').at(-1)}` : '';
      throw new Error(`Could not start ${adapter.label}: ${detail}${suffix}`);
    }
  }

  prompt(text: string, emit: Emit): Promise<void> {
    const turn = this.queue.then(() => this.runPrompt(text, emit));
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  async close(): Promise<void> {
    try {
      await this.connection.closeSession({ sessionId: this.sessionId });
    } catch {
      // The adapter may already have exited.
    }
    if (this.child.stdin.writable) this.child.stdin.end();
    if (!this.child.killed) this.child.kill('SIGTERM');
  }

  private async runPrompt(text: string, emit: Emit): Promise<void> {
    emit({ type: 'status', status: 'thinking' });
    const responsePromise = this.connection.prompt({
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text }],
    });
    responsePromise.then(
      (value) => this.updates.push({ kind: 'stop', value }),
      (error) => this.updates.push({ kind: 'error', value: error }),
    );

    for (;;) {
      const item = await this.updates.next();
      if (item.kind === 'error') {
        throw item.value instanceof Error ? item.value : new Error(String(item.value));
      }
      if (item.kind === 'stop') {
        emit({ type: 'status', status: 'complete' });
        emit({ type: 'done', stopReason: item.value.stopReason });
        return;
      }
      const event = mapUpdate(item.value.update);
      if (event) emit(event);
    }
  }
}

function mapUpdate(update: acp.SessionUpdate): AgentEvent | null {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return update.content.type === 'text' ? { type: 'text', text: update.content.text } : null;
    case 'agent_thought_chunk':
      return update.content.type === 'text' ? { type: 'thought', text: update.content.text } : null;
    case 'tool_call':
      return {
        type: 'tool',
        id: update.toolCallId,
        title: update.title,
        status: update.status ?? undefined,
        kind: update.kind ?? undefined,
      };
    case 'tool_call_update':
      return {
        type: 'tool',
        id: update.toolCallId,
        title: update.title ?? 'Working',
        status: update.status ?? undefined,
        kind: update.kind ?? undefined,
      };
    default:
      return null;
  }
}

function waitForSpawn(child: ChildProcessWithoutNullStreams): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const onSpawn = () => { cleanup(); resolve(); };
  const onError = (error: Error) => { cleanup(); reject(error); };
  const cleanup = () => {
    child.off('spawn', onSpawn);
    child.off('error', onError);
  };
  child.once('spawn', onSpawn);
  child.once('error', onError);
  return promise;
}

class AsyncQueue<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(value: T) => void> = [];

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(value);
    else this.values.push(value);
  }

  next(): Promise<T> {
    const value = this.values.shift();
    if (value !== undefined) return Promise.resolve(value);
    return new Promise((resolveNext) => this.waiters.push(resolveNext));
  }
}
