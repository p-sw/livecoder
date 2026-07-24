// ponytail: every git operation starts a fresh `git` subprocess with the
// requested cwd. No persistent git library, no daemon — straight argv.
// Capturing stdout/stderr separately lets the controller surface partial
// output (e.g. fetch progress) while still returning a structured error.

import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve as resolvePath, dirname } from 'node:path';

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runGit(args: string[], cwd: string, options: { input?: string; env?: Record<string, string>; timeoutMs?: number } = {}): Promise<GitResult> {
  const { promise, resolve, reject } = Promise.withResolvers<GitResult>();
  const child = spawn('git', args, {
    cwd,
    env: {
      ...process.env,
      // ponytail: disable interactive prompts and color codes — git must
      // never hang waiting for input on a server-rpc surface.
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: 'echo',
      NO_COLOR: '1',
      ...options.env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });

  if (options.input) child.stdin.write(options.input);
  child.stdin.end();

  const timeout = options.timeoutMs ?? 5 * 60_000;
  const timer = setTimeout(() => {
    child.kill('SIGTERM');
    reject(new Error(`git ${args[0] ?? ''} timed out after ${timeout}ms`));
  }, timeout);

  child.once('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once('close', (code) => {
    clearTimeout(timer);
    resolve({ stdout, stderr, exitCode: code ?? -1 });
  });
  return promise;
}

export function isGitRepo(path: string): Promise<boolean> {
  return runGit(['rev-parse', '--is-inside-work-tree'], path, { timeoutMs: 10_000 })
    .then((result) => result.exitCode === 0 && result.stdout.trim() === 'true')
    .catch(() => false);
}

// ponytail: clone path resolution per the user-requested rules:
// 1. `BASE_CLONE_PATH` env var (must be a directory the api can mkdir under)
// 2. parent directory of the most recently cloned repo (in-memory)
// 3. the user's home directory
const recentCloneParents = new Map<string, string>();

export function rememberCloneDestination(parent: string): void {
  recentCloneParents.set(parent, parent);
}

export function recallCloneParent(): string | null {
  const last = recentCloneParents.values().next().value;
  return last ?? null;
}

export function resolveClonePath(name: string, requested?: string): string {
  // ponytail: explicit `path` arg wins over the resolver rules so the
  // frontend picker (clone dialog) can override the default.
  if (requested && requested.trim()) return resolvePath(requested.trim());

  const base = process.env.BASE_CLONE_PATH
    ? resolvePath(process.env.BASE_CLONE_PATH)
    : null;
  const fallback = recallCloneParent() ? dirname(recallCloneParent()!) : null;
  const home = homedir();

  const parent = base ?? fallback ?? home;
  return resolvePath(parent, name);
}

export function inferRepoName(url: string): string {
  const trimmed = url.trim().replace(/\.git$/, '');
  const lastSlash = trimmed.lastIndexOf('/');
  const lastColon = trimmed.lastIndexOf(':');
  const cut = Math.max(lastSlash, lastColon);
  return cut >= 0 ? trimmed.slice(cut + 1) : trimmed;
}
