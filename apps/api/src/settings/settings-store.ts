// ponytail: a tiny JSON file at $XDG_CONFIG_HOME/livecoder/settings.json (or
// ~/.config/livecoder/settings.json). Reads on boot, writes on PUT. The
// file is intentionally outside the project tree so overrides don't
// leak into git or ride along with the api's --cwd.
//
// Priority when resolving user-controlled values:
//   1. override from settings.json (this file)
//   2. environment variable
//   3. built-in default
//
// The store does not call back into env. Each resolver asks the store
// for the override and falls back to env / default on null.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { open, rename, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

export interface Settings {
  cloneBasePath: string | null;
  defaultAdapterId: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  cloneBasePath: null,
  defaultAdapterId: null,
};

let cache: Settings = { ...DEFAULT_SETTINGS };
let cacheLoaded = false;

function settingsPath(): string {
  const base = process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'livecoder')
    : join(homedir(), '.config', 'livecoder');
  return join(base, 'settings.json');
}

export function settingsFilePath(): string {
  return settingsPath();
}

// ponytail: synchronous load on boot keeps the surface area small. The file
// is at most a few hundred bytes; blocking the loader for one tick is
// the right trade-off for a config that every request reads.
export function loadSettings(): Settings {
  const path = settingsPath();
  if (!existsSync(path)) {
    cache = { ...DEFAULT_SETTINGS };
    cacheLoaded = true;
    return cache;
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    cache = { ...DEFAULT_SETTINGS, ...sanitize(parsed) };
  } catch {
    // ponytail: corrupt file -> fall back to defaults. Surface the error
    // in the response so the UI can warn the user.
    cache = { ...DEFAULT_SETTINGS };
  }
  cacheLoaded = true;
  return cache;
}

export function getSettings(): Settings {
  if (!cacheLoaded) loadSettings();
  return cache;
}

// ponytail: write to a temp file in the same directory, then rename. The
// rename is atomic on POSIX so a crash mid-write leaves the previous
// settings intact instead of a half-written file.
export async function saveSettings(next: Settings): Promise<Settings> {
  const clean = sanitize(next);
  const merged = { ...DEFAULT_SETTINGS, ...clean };
  const dir = dirname(settingsPath());
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(tmpdir(), `livecoder-settings-${process.pid}-${Date.now()}.json`);
  await writeFileAtomic(tmpPath, JSON.stringify(merged, null, 2));
  await rename(tmpPath, settingsPath());
  cache = merged;
  return cache;
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

function sanitize(input: unknown): Partial<Settings> {
  if (!input || typeof input !== 'object') return {};
  const obj = input as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if (typeof obj.cloneBasePath === 'string' && obj.cloneBasePath.trim().length > 0) {
    out.cloneBasePath = obj.cloneBasePath.trim();
  } else if (obj.cloneBasePath === null) {
    out.cloneBasePath = null;
  }
  if (typeof obj.defaultAdapterId === 'string' && obj.defaultAdapterId.trim().length > 0) {
    out.defaultAdapterId = obj.defaultAdapterId.trim();
  } else if (obj.defaultAdapterId === null) {
    out.defaultAdapterId = null;
  }
  return out;
}

// ponytail: helper for tests + the controller's reset path. Not wired into
// HTTP — clearing the file is the same operation as writing nulls.
export function clearSettings(): void {
  cache = { ...DEFAULT_SETTINGS };
  cacheLoaded = true;
}
