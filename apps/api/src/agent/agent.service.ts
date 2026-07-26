import { Injectable, OnModuleDestroy } from '@nestjs/common';
import * as acp from '@agentclientprotocol/sdk';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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
import { notifyAll } from '../push/push-store.js';

export type AgentEvent =
  | { type: 'status'; status: 'connecting' | 'ready' | 'thinking' | 'complete'; message?: string }
  | { type: 'text'; text: string; messageId?: string }
  | { type: 'thought'; text: string; messageId?: string }
  | { type: 'tool'; id: string; title?: string; status?: string; kind?: string; detail?: string }
  | { type: 'history'; role: 'user'; text: string }
  | { type: 'session'; sessionId: string }
  | { type: 'error'; message: string }
  | { type: 'done'; stopReason?: string };

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
  activeSessionId: string | null;
  capabilities: {
    loadSession: boolean;
    listSessions: boolean;
    closeSession: boolean;
    deleteSession: boolean;
  };
}

export interface SessionInfo {
  sessionId: string;
  cwd?: string;
  title?: string;
  updatedAt?: string;
  active: boolean;
  busy?: boolean;
}

type Emit = (event: AgentEvent) => void;

type QueueItem =
  | { kind: 'notification'; value: acp.SessionNotification }
  | { kind: 'stop'; value: acp.PromptResponse }
  | { kind: 'error'; value: unknown };

@Injectable()
export class AgentService implements OnModuleDestroy {
  // ponytail: one ACP process per (adapter, workspace). Multiple chat
  // sessions ride the same connection via session/new + session/load.
  private readonly runtimes = new Map<string, Promise<AcpRuntime>>();

  async prompt(workspace: string, text: string, emit: Emit, sessionId?: string): Promise<void> {
    try {
      const runtime = await this.getRuntime(workspace, emit);
      await runtime.prompt(text, emit, sessionId);
      // ponytail: ?workspace= so notification click restores the same folder
      const agentUrl = `/agent?workspace=${encodeURIComponent(workspace)}`;
      void notifyAll({ title: 'livecoder', body: 'Agent finished', url: agentUrl });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void notifyAll({ title: 'livecoder', body: `Agent error: ${message}`, url: `/agent?workspace=${encodeURIComponent(workspace)}` });
      throw error;
    }
  }

  async listSessions(workspace: string): Promise<{ sessions: SessionInfo[]; activeSessionId: string | null; busySessionId: string | null; adapter: string }> {
    const adapter = this.resolveAdapter();
    const key = runtimeKey(adapter.id, workspace);
    const existing = this.runtimes.get(key);
    if (!existing) {
      // Runtime not up yet — still surface disk sessions so the picker shows on first open.
      const sessions = await listPersistedSessions(workspace);
      return { sessions, activeSessionId: null, busySessionId: null, adapter: adapter.id };
    }
    const runtime = await existing;
    const sessions = await runtime.listSessions();
    const busySessionId = runtime.busySessionId();
    return {
      sessions: sessions.map((session) => (
        session.sessionId === busySessionId ? { ...session, busy: true } : session
      )),
      activeSessionId: runtime.activeSessionId,
      busySessionId,
      adapter: adapter.id,
    };
  }

  async createSession(workspace: string, emit: Emit): Promise<{ sessionId: string }> {
    const runtime = await this.getRuntime(workspace, emit);
    const sessionId = await runtime.newSession(emit);
    return { sessionId };
  }

  // ponytail: load history (or replay server log) then attach to in-flight turn if any.
  async loadSession(workspace: string, sessionId: string, emit: Emit): Promise<void> {
    const runtime = await this.getRuntime(workspace, emit);
    await runtime.openSession(sessionId, emit);
  }

  async closeSession(workspace: string, sessionId: string): Promise<void> {
    const adapter = this.resolveAdapter();
    const key = runtimeKey(adapter.id, workspace);
    const existing = this.runtimes.get(key);
    if (existing) {
      const runtime = await existing;
      await runtime.closeSession(sessionId);
      return;
    }
    // Runtime not up — still wipe disk so the next list is clean.
    await deletePersistedSession(workspace, sessionId);
  }

  async cancel(workspace: string, sessionId?: string): Promise<void> {
    const adapter = this.resolveAdapter();
    const key = runtimeKey(adapter.id, workspace);
    const existing = this.runtimes.get(key);
    if (!existing) return;
    const runtime = await existing;
    await runtime.cancel(sessionId);
  }

  status(adapterId?: string): AgentStatus {
    const adapter = this.resolveAdapter(adapterId);
    const installed = adapterInstalled(adapter);
    const active = this.findRuntimeSync(adapter.id);
    return {
      configured: installed,
      sessions: this.runtimes.size,
      adapter: adapter.id,
      defaultAdapter: defaultAdapterId(),
      defaultAdapterSource: defaultAdapterSource(),
      adapters: listAdapters().map((spec) => ({
        id: spec.id,
        label: spec.label,
        installed: adapterInstalled(spec),
        active: spec.id === adapter.id,
      })),
      activeSessionId: active?.activeSessionId ?? null,
      capabilities: active?.capabilities ?? {
        loadSession: false,
        listSessions: false,
        closeSession: false,
        deleteSession: false,
      },
    };
  }

  private findRuntimeSync(adapterId: string): AcpRuntime | null {
    for (const [key, promise] of this.runtimes) {
      if (!key.startsWith(`${adapterId}::`)) continue;
      // ponytail: only expose a runtime that has already resolved; pending
      // starts report null until ready.
      const matched = peekResolved(promise);
      if (matched) return matched;
    }
    return null;
  }

  private async getRuntime(workspace: string, emit: Emit): Promise<AcpRuntime> {
    const adapter = this.resolveAdapter();
    const key = runtimeKey(adapter.id, workspace);
    let runtimePromise = this.runtimes.get(key);
    if (!runtimePromise) {
      runtimePromise = AcpRuntime.start(workspace, emit, adapter).then((runtime) => {
        runtime.onExit(() => {
          if (this.runtimes.get(key) === runtimePromise) this.runtimes.delete(key);
        });
        return runtime;
      });
      this.runtimes.set(key, runtimePromise);
      runtimePromise.catch(() => {
        if (this.runtimes.get(key) === runtimePromise) this.runtimes.delete(key);
      });
    }
    try {
      return await runtimePromise;
    } catch (error) {
      this.runtimes.delete(key);
      throw error;
    }
  }

  private resolveAdapter(adapterId?: string): AdapterSpec {
    // ponytail: adapter comes from settings/env only. Request overrides are
    // ignored so the Agent tab can't drift from configuration.
    const resolved = resolveAdapter(adapterId || defaultAdapterId());
    if (resolved) return resolved;
    const fallback = resolveAdapter(defaultAdapterId());
    if (fallback) return fallback;
    return { id: 'pi', label: 'Pi', command: 'pi-acp', args: [] };
  }

  async onModuleDestroy(): Promise<void> {
    const runtimes = await Promise.allSettled(this.runtimes.values());
    await Promise.all(
      runtimes.flatMap((result) => (result.status === 'fulfilled' ? [result.value.dispose()] : [])),
    );
    this.runtimes.clear();
  }
}

class AcpRuntime {
  private queue: Promise<void> = Promise.resolve();
  // ponytail: fan-out + ring of turn events so a tab can reconnect mid-flight.
  private activePrompt: { sessionId: string; listeners: Set<Emit> } | null = null;
  // Accumulates history/turn events for the active session while this runtime lives.
  private sessionEvents: AgentEvent[] = [];
  private sessionEventsId: string | null = null;
  private exitHandlers: Array<() => void> = [];
  private dead = false;
  activeSessionId: string | null = null;
  readonly capabilities: AgentStatus['capabilities'];

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly connection: acp.ClientSideConnection,
    private readonly cwd: string,
    private readonly adapter: AdapterSpec,
    private readonly updates: AsyncQueue<QueueItem>,
    capabilities: AgentStatus['capabilities'],
    private readonly turnGate: TurnGate,
  ) {
    this.capabilities = capabilities;
  }

  static async start(cwd: string, emit: Emit, adapter: AdapterSpec): Promise<AcpRuntime> {
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
    const turnGate = new TurnGate();
    const client: acp.Client = {
      requestPermission: async (params) => {
        const option = params.options.find((item) => item.kind === 'allow_once')
          ?? params.options.find((item) => item.kind === 'allow_always')
          ?? params.options[0];
        if (!option) return { outcome: { outcome: 'cancelled' } };
        return { outcome: { outcome: 'selected', optionId: option.optionId } };
      },
      sessionUpdate: async (params) => {
        // ponytail: drop updates when no prompt/load is listening so startup
        // noise (available_commands, session_info) can't poison the next turn.
        if (!turnGate.open) return;
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

    const runtimeHolder: { current: AcpRuntime | null } = { current: null };

    const fail = (error: unknown) => {
      updates.push({ kind: 'error', value: error });
      runtimeHolder.current?.markDead();
    };
    void connection.closed.then(() => fail(new Error(`${adapter.label} connection closed`)));
    child.once('exit', (code, signal) => {
      fail(new Error(`${adapter.label} exited${code != null ? ` (${code})` : signal ? ` (${signal})` : ''}`));
    });

    try {
      const init = await connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientInfo: { name: 'livecoder', title: 'livecoder', version: '0.1.0' },
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
        },
      });
      const caps = init.agentCapabilities ?? {};
      const sessionCaps = caps.sessionCapabilities ?? {};
      const runtime = new AcpRuntime(child, connection, cwd, adapter, updates, {
        loadSession: Boolean(caps.loadSession),
        listSessions: sessionCaps.list != null,
        closeSession: sessionCaps.close != null,
        // ACP delete removes persisted history; close only frees the live handle.
        deleteSession: sessionCaps.delete != null,
      }, turnGate);
      runtimeHolder.current = runtime;

      // ponytail: no session until prompt/create/load — start used to
      // session/new here and every agent-tab open left an empty junk session.
      emit({ type: 'status', status: 'ready', message: `${adapter.label} is ready` });
      return runtime;
    } catch (error) {
      child.kill();
      const detail = error instanceof Error ? error.message : String(error);
      const suffix = stderr.trim() ? ` — ${stderr.trim().split('\n').at(-1)}` : '';
      throw new Error(`Could not start ${adapter.label}: ${detail}${suffix}`);
    }
  }

  onExit(handler: () => void): void {
    this.exitHandlers.push(handler);
    if (this.dead) handler();
  }

  markDead(): void {
    if (this.dead) return;
    this.dead = true;
    for (const handler of this.exitHandlers) handler();
  }

  async newSession(emit: Emit): Promise<string> {
    this.assertAlive();
    // Close previous active session when the agent supports it.
    if (this.activeSessionId && this.capabilities.closeSession) {
      try {
        await this.connection.closeSession({ sessionId: this.activeSessionId });
      } catch {
        // Adapter may already have torn it down (e.g. closeAllExcept).
      }
    }
    const session = await this.connection.newSession({ cwd: this.cwd, mcpServers: [] });
    this.activeSessionId = session.sessionId;
    this.sessionEventsId = session.sessionId;
    this.sessionEvents = [];
    emit({ type: 'session', sessionId: session.sessionId });
    return session.sessionId;
  }

  busySessionId(): string | null {
    return this.activePrompt?.sessionId ?? null;
  }

  // Replay server-side log when we have it; otherwise ACP load. Then tail in-flight turn.
  async openSession(sessionId: string, emit: Emit): Promise<void> {
    this.assertAlive();
    if (this.activePrompt && this.activePrompt.sessionId !== sessionId) {
      throw new Error('Agent is busy with another session');
    }

    // In-flight turn owns the update queue — only replay the RAM log + follow.
    if (this.activePrompt?.sessionId === sessionId) {
      const from = this.sessionEventsId === sessionId ? this.sessionEvents.length : 0;
      if (this.sessionEventsId === sessionId) {
        for (let i = 0; i < from; i += 1) {
          const event = this.sessionEvents[i];
          if (event.type === 'done') continue;
          emit(event);
        }
      }
      emit({ type: 'session', sessionId });
      emit({ type: 'status', status: 'thinking' });
      await this.followTurn(emit, from);
      return;
    }

    if (this.sessionEventsId === sessionId && this.sessionEvents.length > 0) {
      for (const event of this.sessionEvents) {
        if (event.type === 'done') continue;
        emit(event);
      }
      emit({ type: 'session', sessionId });
      emit({ type: 'status', status: 'ready', message: 'Session restored' });
      emit({ type: 'done' });
      return;
    }

    await this.loadSession(sessionId, (event) => {
      if (event.type === 'done') return;
      emit(event);
    });
    emit({ type: 'done' });
  }

  private async loadSession(sessionId: string, emit: Emit): Promise<void> {
    this.assertAlive();
    if (!this.capabilities.loadSession) {
      throw new Error(`${this.adapter.label} does not support loading sessions`);
    }
    emit({ type: 'status', status: 'connecting', message: 'Loading session…' });
    this.sessionEventsId = sessionId;
    this.sessionEvents = [];
    const record: Emit = (event) => {
      this.sessionEvents.push(event);
      emit(event);
    };
    this.turnGate.enter();
    this.updates.clear();
    try {
      const loadPromise = this.connection.loadSession({
        sessionId,
        cwd: this.cwd,
        mcpServers: [],
      });
      // Replay history while loadSession streams session/update notifications.
      const replay = this.drainUntil(loadPromise, (update) => {
        const event = mapHistoryUpdate(update);
        if (event) record(event);
      });
      await loadPromise;
      await replay;
      this.activeSessionId = sessionId;
      record({ type: 'session', sessionId });
      record({ type: 'status', status: 'ready', message: 'Session loaded' });
    } finally {
      this.turnGate.leave();
      this.updates.clear();
    }
  }

  async listSessions(): Promise<SessionInfo[]> {
    this.assertAlive();
    if (!this.capabilities.listSessions) return this.activeSessionId
      ? [{ sessionId: this.activeSessionId, cwd: this.cwd, active: true }]
      : [];
    const all: SessionInfo[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await this.connection.listSessions({ cwd: this.cwd, cursor });
      for (const item of page.sessions ?? []) {
        all.push({
          sessionId: item.sessionId,
          cwd: item.cwd ?? undefined,
          title: item.title ?? undefined,
          updatedAt: item.updatedAt ?? undefined,
          active: item.sessionId === this.activeSessionId,
        });
      }
      cursor = page.nextCursor ?? null;
    } while (cursor);
    return all;
  }

  async closeSession(sessionId: string): Promise<void> {
    this.assertAlive();
    // Prefer real delete when the agent supports it.
    if (this.capabilities.deleteSession) {
      try {
        await this.connection.deleteSession({ sessionId });
      } catch {
        // fall through to close + disk wipe
      }
    } else if (this.capabilities.closeSession) {
      try {
        await this.connection.closeSession({ sessionId });
      } catch {
        // ignore
      }
    }
    // ponytail: omp/pi listSessions reads disk; close only drops RAM. Wipe files so delete sticks.
    await deletePersistedSession(this.cwd, sessionId);
    if (this.activeSessionId === sessionId) this.activeSessionId = null;
    if (this.sessionEventsId === sessionId) {
      this.sessionEventsId = null;
      this.sessionEvents = [];
    }
  }

  async cancel(sessionId?: string): Promise<void> {
    const id = sessionId ?? this.activeSessionId ?? this.activePrompt?.sessionId;
    if (!id) return;
    try {
      await this.connection.cancel({ sessionId: id });
    } catch {
      // cancel is best-effort
    }
  }

  prompt(text: string, emit: Emit, sessionId?: string): Promise<void> {
    const turn = this.queue.then(() => this.runPrompt(text, emit, sessionId));
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  async dispose(): Promise<void> {
    this.markDead();
    if (this.activeSessionId && this.capabilities.closeSession) {
      try {
        await this.connection.closeSession({ sessionId: this.activeSessionId });
      } catch {
        // ignore
      }
    }
    if (this.child.stdin.writable) this.child.stdin.end();
    if (!this.child.killed) this.child.kill('SIGTERM');
  }

  private async runPrompt(text: string, emit: Emit, sessionId?: string): Promise<void> {
    this.assertAlive();
    let id = sessionId ?? this.activeSessionId;
    if (!id) id = await this.newSession(emit);
    this.activeSessionId = id;
    if (this.sessionEventsId !== id) {
      this.sessionEventsId = id;
      this.sessionEvents = [];
    }

    const turn = { sessionId: id, listeners: new Set<Emit>() };
    this.activePrompt = turn;
    const broadcast: Emit = (event) => {
      this.sessionEvents.push(event);
      emit(event);
      for (const listener of turn.listeners) listener(event);
    };

    broadcast({ type: 'session', sessionId: id });
    // so reconnect replays the user line without an ACP history reload
    broadcast({ type: 'history', role: 'user', text });
    broadcast({ type: 'status', status: 'thinking' });

    this.turnGate.enter();
    this.updates.clear();
    try {
      const responsePromise = this.connection.prompt({
        sessionId: id,
        prompt: [{ type: 'text', text }],
      });
      responsePromise.then(
        (value) => this.updates.push({ kind: 'stop', value }),
        (error) => this.updates.push({ kind: 'error', value: error }),
      );

      for (;;) {
        const item = await this.updates.next();
        if (item.kind === 'error') {
          this.markDead();
          const message = item.value instanceof Error ? item.value.message : String(item.value);
          broadcast({ type: 'error', message });
          broadcast({ type: 'done' });
          throw item.value instanceof Error ? item.value : new Error(message);
        }
        if (item.kind === 'stop') {
          broadcast({ type: 'status', status: 'complete' });
          broadcast({ type: 'done', stopReason: item.value.stopReason });
          return;
        }
        // Only surface updates for the active session.
        if (item.value.sessionId && item.value.sessionId !== id) continue;
        const event = mapUpdate(item.value.update);
        if (event) broadcast(event);
      }
    } finally {
      this.activePrompt = null;
      turn.listeners.clear();
      this.turnGate.leave();
      this.updates.clear();
    }
  }

  // ponytail: follower pumps sessionEvents from `from` so attach can't skip/dup.
  private followTurn(emit: Emit, from: number): Promise<void> {
    const turn = this.activePrompt;
    if (!turn) {
      emit({ type: 'done' });
      return Promise.resolve();
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    let index = from;
    const pump = (): boolean => {
      while (index < this.sessionEvents.length) {
        const event = this.sessionEvents[index];
        index += 1;
        emit(event);
        if (event.type === 'done' || event.type === 'error') {
          turn.listeners.delete(onNotify);
          resolve();
          return true;
        }
      }
      return false;
    };
    const onNotify: Emit = () => {
      pump();
    };
    turn.listeners.add(onNotify);
    if (pump()) return promise;
    if (this.activePrompt !== turn) {
      turn.listeners.delete(onNotify);
      if (!pump()) {
        emit({ type: 'done' });
        resolve();
      }
    }
    return promise;
  }

  private async drainUntil(done: Promise<unknown>, onUpdate: (update: acp.SessionUpdate) => void): Promise<void> {
    let finished = false;
    void done.finally(() => {
      finished = true;
      this.updates.push({ kind: 'stop', value: { stopReason: 'end_turn' } });
    });
    while (!finished) {
      const item = await this.updates.next();
      if (item.kind === 'error') {
        this.markDead();
        throw item.value instanceof Error ? item.value : new Error(String(item.value));
      }
      if (item.kind === 'stop') return;
      onUpdate(item.value.update);
    }
  }

  private assertAlive(): void {
    if (this.dead) throw new Error(`${this.adapter.label} connection is closed`);
  }
}

function mapUpdate(update: acp.SessionUpdate): AgentEvent | null {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return update.content.type === 'text'
        ? { type: 'text', text: update.content.text, messageId: update.messageId ?? undefined }
        : null;
    case 'agent_thought_chunk':
      return update.content.type === 'text' ? { type: 'thought', text: update.content.text, messageId: update.messageId ?? undefined } : null;
    case 'tool_call':
    case 'tool_call_update':
      return {
        type: 'tool',
        id: update.toolCallId,
        // ponytail: never invent "Working" — client keeps the last real title on partial updates
        title: update.title ?? undefined,
        status: update.status ?? undefined,
        kind: update.kind ?? undefined,
        detail: formatToolDetail(update),
      };
    default:
      return null;
  }
}

function formatToolDetail(
  update: { content?: acp.ToolCallContent[] | null; locations?: acp.ToolCallLocation[] | null; rawInput?: unknown; rawOutput?: unknown },
): string | undefined {
  const parts: string[] = [];
  if (update.locations?.length) {
    parts.push(update.locations.map((l) => (l.line != null ? `${l.path}:${l.line}` : l.path)).join('\n'));
  }
  if (update.rawInput !== undefined) parts.push(typeof update.rawInput === 'string' ? update.rawInput : JSON.stringify(update.rawInput, null, 2));
  if (update.content?.length) {
    for (const block of update.content) {
      if (block.type === 'content' && block.content.type === 'text') parts.push(block.content.text);
      else if (block.type === 'diff') {
        const old = block.oldText?.trim() ? `${block.oldText}\n` : '';
        parts.push(`${block.path}\n${old}${block.newText}`);
      }
    }
  }
  if (update.rawOutput !== undefined) parts.push(typeof update.rawOutput === 'string' ? update.rawOutput : JSON.stringify(update.rawOutput, null, 2));
  return parts.length ? parts.join('\n\n') : undefined;
}

function mapHistoryUpdate(update: acp.SessionUpdate): AgentEvent | null {
  // ponytail: replay uses the same event shapes as live turns so the client
  // can rebuild tool/thought/message bubbles instead of one flattened blob.
  if (update.sessionUpdate === 'user_message_chunk') {
    return update.content.type === 'text' ? { type: 'history', role: 'user', text: update.content.text } : null;
  }
  return mapUpdate(update);
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

function runtimeKey(adapterId: string, workspace: string): string {
  return `${adapterId}::${workspace}`;
}

// ponytail: pi/omp store sessions under ~/.{omp,pi}/agent/sessions/<cwd-encoded>/
function sessionDirCandidates(cwd: string): string[] {
  const resolved = path.resolve(cwd);
  const home = os.homedir();
  const rel = path.relative(home, resolved);
  const names = new Set<string>();
  names.add(`--${resolved.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    names.add(rel ? `-${rel.replace(/[/\\:]/g, '-')}` : '-');
  }
  const roots = [
    path.join(home, '.omp', 'agent', 'sessions'),
    path.join(home, '.pi', 'agent', 'sessions'),
  ];
  return roots.flatMap((root) => [...names].map((name) => path.join(root, name)));
}

async function deletePersistedSession(cwd: string, sessionId: string): Promise<void> {
  for (const dir of sessionDirCandidates(cwd)) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.includes(sessionId)) continue;
      const full = path.join(dir, entry);
      try {
        const st = await fs.stat(full);
        if (st.isDirectory()) {
          await fs.rm(full, { recursive: true, force: true });
        } else {
          await fs.unlink(full);
          if (entry.endsWith('.jsonl')) {
            await fs.rm(full.slice(0, -'.jsonl'.length), { recursive: true, force: true }).catch(() => undefined);
          }
        }
      } catch {
        // best-effort per entry
      }
    }
  }
}

async function listPersistedSessions(cwd: string): Promise<SessionInfo[]> {
  const byId = new Map<string, SessionInfo>();
  for (const dir of sessionDirCandidates(cwd)) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const match = entry.match(/_([0-9a-f-]{36})\.jsonl$/i);
      if (!match) continue;
      const sessionId = match[1];
      if (byId.has(sessionId)) continue;
      const full = path.join(dir, entry);
      let title: string | undefined;
      let updatedAt: string | undefined;
      try {
        const st = await fs.stat(full);
        updatedAt = st.mtime.toISOString();
        // first lines hold title/session metadata — don't parse the whole transcript
        const fh = await fs.open(full, 'r');
        try {
          const buf = Buffer.alloc(4096);
          const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
          const head = buf.subarray(0, bytesRead).toString('utf8');
          for (const line of head.split('\n')) {
            if (!line.trim()) continue;
            try {
              const row = JSON.parse(line) as { type?: string; title?: string; updatedAt?: string; timestamp?: string; cwd?: string };
              if (row.type === 'title' && row.title?.trim()) title = row.title.trim();
              if (row.type === 'title' && row.updatedAt) updatedAt = row.updatedAt;
              if (row.type === 'session' && row.timestamp) updatedAt = row.timestamp;
            } catch {
              // skip bad line
            }
          }
        } finally {
          await fh.close();
        }
      } catch {
        continue;
      }
      byId.set(sessionId, { sessionId, cwd, title, updatedAt, active: false });
    }
  }
  return [...byId.values()].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

// ponytail: tiny gate so sessionUpdate can no-op when nothing is draining.
class TurnGate {
  private depth = 0;
  get open(): boolean { return this.depth > 0; }
  enter(): void { this.depth += 1; }
  leave(): void { this.depth = Math.max(0, this.depth - 1); }
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
    const { promise, resolve } = Promise.withResolvers<T>();
    this.waiters.push(resolve);
    return promise;
  }

  clear(): void {
    this.values.length = 0;
  }
}

// ponytail: Promise.inspect isn't standard; stash the value when resolved.
const resolvedPeek = new WeakMap<Promise<unknown>, unknown>();
function peekResolved<T>(promise: Promise<T>): T | null {
  if (resolvedPeek.has(promise)) return resolvedPeek.get(promise) as T;
  void promise.then((value) => resolvedPeek.set(promise, value));
  return null;
}
