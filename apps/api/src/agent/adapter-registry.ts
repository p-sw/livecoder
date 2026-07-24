// ponytail: named adapter registry. Each entry describes how to spawn an
// ACP-compatible agent. The frontend picks a name; the backend resolves it
// to a command/args pair. Resolution happens lazily on first use so missing
// binaries are detected at chat time, not at boot.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSettings } from '../settings/settings-store.js';

export interface AdapterSpec {
  /** stable id used over the wire (e.g. "pi", "oh-my-pi") */
  id: string;
  /** short label for UI */
  label: string;
  /** command-line argv to launch the adapter */
  command: string;
  args: string[];
}

// ponytail: built-in adapters. `oh-my-pi` is opt-in — the binary may not be
// on every machine. The frontend falls back to `pi` when `oh-my-pi` reports
// unavailable.
const BUILTIN_ADAPTERS: AdapterSpec[] = [
  { id: 'pi', label: 'Pi', command: 'pi-acp', args: [] },
  { id: 'oh-my-pi', label: 'Oh-My-Pi', command: 'oh-my-pi-acp', args: [] },
];

function parseEnvArgs(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    /* fall through to empty */
  }
  return [];
}

function envOverrideSpecs(): AdapterSpec[] {
  // ponytail: env convention is PI_ADAPTER_<ID> (+ optional _ARGS sibling).
  // The id part must be uppercase letters/digits/underscores; we lowercase
  // and dashify so `PI_ADAPTER_OH_MY_PI` becomes the on-the-wire `oh-my-pi`.
  const specs: AdapterSpec[] = [];
  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^PI_ADAPTER_([A-Z][A-Z0-9_]*)(_ARGS)?$/);
    if (!match || !value) continue;
    const id = match[1].toLowerCase().replace(/_/g, '-');
    const isArgs = Boolean(match[2]);
    const existing = specs.find((s) => s.id === id);
    if (isArgs) {
      if (existing) existing.args = parseEnvArgs(value);
    } else if (!existing) {
      specs.push({ id, label: id, command: value, args: [] });
    }
  }
  return specs;
}

export function listAdapters(): AdapterSpec[] {
  // ponytail: env overrides win over built-ins by id so users can retitle or
  // swap the command without editing code.
  const overrides = new Map(envOverrideSpecs().map((spec) => [spec.id, spec]));
  const merged: AdapterSpec[] = [];
  for (const spec of BUILTIN_ADAPTERS) {
    const override = overrides.get(spec.id);
    merged.push(override ?? spec);
    overrides.delete(spec.id);
  }
  for (const spec of overrides.values()) merged.push(spec);
  return merged;
}

export function findAdapter(id: string): AdapterSpec | null {
  return listAdapters().find((spec) => spec.id === id) ?? null;
}

// ponytail: priority order — settings.json override > env var > built-in
// 'pi'. The settings controller writes to a separate file (not .env) and
// is consulted at lookup time so changing the default takes effect without
// a process restart.
export function defaultAdapterId(): string {
  const override = getSettings().defaultAdapterId;
  if (override) return override;
  return process.env.PI_ADAPTER_DEFAULT ?? 'pi';
}

export type DefaultSource = 'settings' | 'env' | 'builtin';

export function defaultAdapterSource(): DefaultSource {
  const override = getSettings().defaultAdapterId;
  if (override) return 'settings';
  if (process.env.PI_ADAPTER_DEFAULT) return 'env';
  return 'builtin';
}

export function resolveCloneSource(): DefaultSource {
  const override = getSettings().cloneBasePath;
  if (override) return 'settings';
  if (process.env.BASE_CLONE_PATH) return 'env';
  return 'builtin';
}
// ponytail: legacy `PI_ACP_COMMAND` / `PI_ACP_ARGS` overrides still take
// precedence over the registry so existing deployments keep working.
function legacyOverride(): AdapterSpec | null {
  if (!process.env.PI_ACP_COMMAND) return null;
  return {
    id: 'pi',
    label: 'Pi (env override)',
    command: process.env.PI_ACP_COMMAND,
    args: parseEnvArgs(process.env.PI_ACP_ARGS),
  };
}

export function resolveAdapter(id: string): AdapterSpec | null {
  const legacy = legacyOverride();
  if (legacy) return legacy;
  return findAdapter(id) ?? findAdapter(defaultAdapterId());
}

export function resolveAdapterCommand(adapter: AdapterSpec): { command: string; args: string[] } {
  // ponytail: trust PATH first, fall back to the project's local bins so
  // a fresh `bun install` works without a global `pi-acp`.
  const candidates = [adapter.command, localBin(adapter.command)];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return { command: candidate, args: adapter.args };
  }
  return { command: adapter.command, args: adapter.args };
}

function localBin(binary: string): string | null {
  const suffix = process.platform === 'win32' ? '.cmd' : '';
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), 'node_modules', '.bin', `${binary}${suffix}`),
    join(process.cwd(), '..', '..', 'node_modules', '.bin', `${binary}${suffix}`),
    join(moduleDirectory, '..', '..', '..', '..', 'node_modules', '.bin', `${binary}${suffix}`),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function adapterInstalled(adapter: AdapterSpec): boolean {
  if (localBin(adapter.command)) return true;
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [adapter.command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
