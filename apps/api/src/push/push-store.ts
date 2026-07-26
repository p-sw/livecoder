// ponytail: VAPID keys + push endpoints live next to settings.json.
// One shared keypair per install; subscriptions are a JSON array.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { open, rename, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import webpush from 'web-push';

export interface PushSubscriptionJSON {
  endpoint: string;
  expirationTime?: number | null;
  keys?: { p256dh?: string; auth?: string };
}

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

interface PushState {
  vapid: VapidKeys;
  subscriptions: PushSubscriptionJSON[];
}

const EMPTY: PushState = {
  vapid: { publicKey: '', privateKey: '' },
  subscriptions: [],
};

let cache: PushState | null = null;

function configDir(): string {
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'livecoder')
    : join(homedir(), '.config', 'livecoder');
}

function statePath(): string {
  return join(configDir(), 'push.json');
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  let handle: FileHandle | null = null;
  try {
    handle = await open(path, 'w');
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    if (handle) await handle.close();
  }
}

async function persist(state: PushState): Promise<void> {
  const dir = dirname(statePath());
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(tmpdir(), `livecoder-push-${process.pid}-${Date.now()}.json`);
  await writeFileAtomic(tmpPath, JSON.stringify(state, null, 2));
  await rename(tmpPath, statePath());
  cache = state;
}

function loadRaw(): PushState {
  const path = statePath();
  if (!existsSync(path)) return { ...EMPTY, subscriptions: [] };
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY, subscriptions: [] };
    const obj = parsed as Record<string, unknown>;
    const vapid = obj.vapid && typeof obj.vapid === 'object'
      ? obj.vapid as VapidKeys
      : { publicKey: '', privateKey: '' };
    const subscriptions = Array.isArray(obj.subscriptions)
      ? (obj.subscriptions as PushSubscriptionJSON[]).filter((s) => s && typeof s.endpoint === 'string')
      : [];
    return {
      vapid: {
        publicKey: typeof vapid.publicKey === 'string' ? vapid.publicKey : '',
        privateKey: typeof vapid.privateKey === 'string' ? vapid.privateKey : '',
      },
      subscriptions,
    };
  } catch {
    return { ...EMPTY, subscriptions: [] };
  }
}

export async function ensurePushReady(): Promise<VapidKeys> {
  if (!cache) cache = loadRaw();
  if (!cache.vapid.publicKey || !cache.vapid.privateKey) {
    const generated = webpush.generateVAPIDKeys();
    cache = {
      vapid: { publicKey: generated.publicKey, privateKey: generated.privateKey },
      subscriptions: cache.subscriptions,
    };
    await persist(cache);
  }
  // Apple rejects mailto:…@localhost (BadJwtToken). Prefer a real contact via VAPID_SUBJECT.
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:livecoder@example.com',
    cache.vapid.publicKey,
    cache.vapid.privateKey,
  );
  return cache.vapid;
}

export function getVapidPublicKey(): string | null {
  if (!cache) cache = loadRaw();
  return cache.vapid.publicKey || null;
}

export async function saveSubscription(sub: PushSubscriptionJSON): Promise<void> {
  if (!sub?.endpoint) return;
  if (!cache) cache = loadRaw();
  const rest = cache.subscriptions.filter((s) => s.endpoint !== sub.endpoint);
  cache = { ...cache, subscriptions: [...rest, sub] };
  await persist(cache);
}

export async function removeSubscription(endpoint: string): Promise<void> {
  if (!cache) cache = loadRaw();
  cache = {
    ...cache,
    subscriptions: cache.subscriptions.filter((s) => s.endpoint !== endpoint),
  };
  await persist(cache);
}

export async function notifyAll(payload: {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}): Promise<void> {
  await ensurePushReady();
  if (!cache) cache = loadRaw();
  const body = JSON.stringify({
    title: payload.title ?? 'livecoder',
    body: payload.body ?? 'Agent finished',
    url: payload.url ?? '/agent',
    tag: payload.tag ?? 'agent-finished',
  });
  const dead: string[] = [];
  await Promise.all(cache.subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(sub as webpush.PushSubscription, body);
    } catch (err) {
      const status = err && typeof err === 'object' && 'statusCode' in err && typeof err.statusCode === 'number'
        ? err.statusCode
        : undefined;
      const detail = err && typeof err === 'object' && 'body' in err && typeof err.body === 'string'
        ? err.body
        : err instanceof Error ? err.message : String(err);
      // 404/410 = gone
      if (status === 404 || status === 410) dead.push(sub.endpoint);
      else console.warn(`[push] send failed ${status ?? ''}: ${detail}`);
    }
  }));
  if (dead.length) {
    cache = {
      ...cache,
      subscriptions: cache.subscriptions.filter((s) => !dead.includes(s.endpoint)),
    };
    await persist(cache);
  }
}
