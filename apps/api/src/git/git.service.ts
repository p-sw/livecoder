// ponytail: thin git wrapper. Each public method maps to one or two `git`
// invocations and returns plain JSON the frontend can render directly.
// Long-running ops (clone, fetch, push, pull) accept an optional progress
// callback so the controller can stream them over SSE; the rest are
// fire-and-await.

import { existsSync, mkdirSync } from 'node:fs';
import { Injectable } from '@nestjs/common';
import { dirname } from 'node:path';
import {
  type GitResult,
  inferRepoName,
  isGitRepo,
  recallCloneParent,
  rememberCloneDestination,
  resolveClonePath,
  runGit,
} from './git-runner.js';

export interface RemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface BranchInfo {
  name: string;
  current: boolean;
  remote: boolean;
  upstream?: string;
}

export interface TagInfo {
  name: string;
  hash: string;
  message?: string;
}

export interface CommitInfo {
  hash: string;
  short: string;
  author: string;
  email: string;
  date: string;
  subject: string;
  body?: string;
  refs?: string;
}

export interface DiffFileInfo {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'typechange';
  oldPath?: string;
  additions: number;
  deletions: number;
  binary: boolean;
  diff: string;
}

export interface StatusInfo {
  branch: string;
  upstream?: { name: string; ahead: number; behind: number };
  clean: boolean;
  files: DiffFileInfo[];
  shortstat: { added: number; modified: number; deleted: number; untracked: number };
}

export interface CloneResult {
  path: string;
  parent: string;
  inferred: boolean;
}

// ponytail: a per-workspace module for the git view. Keeps endpoints thin
// and lets the controller focus on HTTP plumbing.
@Injectable()
export class GitService {
  async resolvePath(workspace: string): Promise<string> {
    if (!await isGitRepo(workspace)) {
      throw new Error('Not a git repository');
    }
    return workspace;
  }

  async clone(url: string, path?: string): Promise<CloneResult> {
    const name = inferRepoName(url);
    const target = resolveClonePath(name, path);
    const parent = dirname(target);

    if (existsSync(target)) {
      throw new Error(`Destination already exists: ${target}`);
    }
    mkdirSync(parent, { recursive: true });

    const result = await runGit(['clone', url, target], parent, { timeoutMs: 10 * 60_000 });
    if (result.exitCode !== 0) {
      throw new Error(formatGitError('clone', result));
    }
    rememberCloneDestination(parent);
    return { path: target, parent, inferred: !path };
  }

  clonePathSuggestion(name: string): { parent: string; source: 'env' | 'history' | 'home' | 'requested' | 'unnamed' } {
    if (process.env.BASE_CLONE_PATH) return { parent: process.env.BASE_CLONE_PATH, source: 'env' };
    const last = recallCloneParent();
    if (last) return { parent: last, source: 'history' };
    const { homedir } = require('node:os') as typeof import('node:os');
    return { parent: homedir(), source: 'home' };
  }

  async status(workspace: string): Promise<StatusInfo> {
    const cwd = await this.resolvePath(workspace);
    const branchResult = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    if (branchResult.exitCode !== 0) throw new Error(formatGitError('status', branchResult));
    const branch = branchResult.stdout.trim();

    const upstream = await this.readUpstream(cwd, branch);
    const porcelain = await runGit(['status', '--porcelain=v1', '-uall'], cwd);
    if (porcelain.exitCode !== 0) throw new Error(formatGitError('status', porcelain));
    const files = await this.parsePorcelain(porcelain.stdout, cwd);

    const shortstat = files.reduce((acc, file) => {
      if (file.status === 'untracked') acc.untracked += 1;
      else if (file.status === 'deleted') acc.deleted += 1;
      else if (file.status === 'added') acc.added += 1;
      else acc.modified += 1;
      return acc;
    }, { added: 0, modified: 0, deleted: 0, untracked: 0 });

    return {
      branch,
      upstream,
      clean: files.length === 0,
      files,
      shortstat,
    };
  }

  async log(workspace: string, limit = 50): Promise<CommitInfo[]> {
    const cwd = await this.resolvePath(workspace);
    const format = ['%H', '%h', '%an', '%ae', '%aI', '%s', '%b', '%D'].join('@LIVECODER@');
    const result = await runGit(['log', `--pretty=format:${format}`, '-z', `-n${limit}`], cwd);
    if (result.exitCode !== 0) throw new Error(formatGitError('log', result));
    return parseCommitList(result.stdout);
  }

  async diff(workspace: string, path?: string, staged = false): Promise<DiffFileInfo[]> {
    const cwd = await this.resolvePath(workspace);
    const optArgs: string[] = ['diff', '--no-color'];
    if (staged) optArgs.push('--cached');
    const pathArgs: string[] = [];
    if (path) pathArgs.push(path);
    const stat = await runGit([...optArgs, '--numstat', '--', ...pathArgs], cwd);
    if (stat.exitCode !== 0) throw new Error(formatGitError('diff', stat));
    const status = await runGit([...optArgs, '--name-status', '-z', '--diff-filter=ACDMRTUXB', '--', ...pathArgs], cwd);
    if (status.exitCode !== 0) throw new Error(formatGitError('diff', status));
    const patch = await runGit([...optArgs, '--', ...pathArgs], cwd);
    if (patch.exitCode !== 0) throw new Error(formatGitError('diff', patch));
    const tracked = pathArgs.length === 0 ? await this.untracked(cwd) : [];
    return parseDiff(status.stdout, stat.stdout, patch.stdout, tracked);
  }

  async stage(workspace: string, paths: string[]): Promise<void> {
    const cwd = await this.resolvePath(workspace);
    if (paths.length === 0) return;
    const result = await runGit(['add', '--', ...paths], cwd);
    if (result.exitCode !== 0) throw new Error(formatGitError('add', result));
  }

  async unstage(workspace: string, paths: string[]): Promise<void> {
    const cwd = await this.resolvePath(workspace);
    if (paths.length === 0) return;
    const result = await runGit(['restore', '--staged', '--', ...paths], cwd);
    if (result.exitCode !== 0) throw new Error(formatGitError('unstage', result));
  }

  async commit(workspace: string, message: string, options: { all?: boolean } = {}): Promise<{ hash: string; short: string }> {
    const cwd = await this.resolvePath(workspace);
    if (!message.trim()) throw new Error('Commit message is required');
    const args = ['commit', '-m', message];
    if (options.all) args.push('-a');
    const result = await runGit(args, cwd);
    if (result.exitCode !== 0) throw new Error(formatGitError('commit', result));
    const head = await runGit(['rev-parse', 'HEAD'], cwd);
    const hash = head.stdout.trim();
    return { hash, short: hash.slice(0, 7) };
  }

  async push(workspace: string, options: { remote?: string; branch?: string; setUpstream?: boolean } = {}): Promise<GitResult> {
    const cwd = await this.resolvePath(workspace);
    const args = ['push'];
    if (options.setUpstream) args.push('-u');
    if (options.remote) args.push(options.remote);
    if (options.branch) args.push(options.branch);
    const result = await runGit(args, cwd, { timeoutMs: 10 * 60_000 });
    if (result.exitCode !== 0) throw new Error(formatGitError('push', result));
    return result;
  }

  async pull(workspace: string, options: { remote?: string; branch?: string } = {}): Promise<GitResult> {
    const cwd = await this.resolvePath(workspace);
    const args = ['pull'];
    if (options.remote) args.push(options.remote);
    if (options.branch) args.push(options.branch);
    const result = await runGit(args, cwd, { timeoutMs: 10 * 60_000 });
    if (result.exitCode !== 0) throw new Error(formatGitError('pull', result));
    return result;
  }

  async fetch(workspace: string, options: { remote?: string; prune?: boolean } = {}): Promise<GitResult> {
    const cwd = await this.resolvePath(workspace);
    const args = ['fetch'];
    if (options.prune) args.push('--prune');
    if (options.remote) args.push(options.remote);
    const result = await runGit(args, cwd, { timeoutMs: 10 * 60_000 });
    if (result.exitCode !== 0) throw new Error(formatGitError('fetch', result));
    return result;
  }

  async branches(workspace: string): Promise<BranchInfo[]> {
    const cwd = await this.resolvePath(workspace);
    const [local, remote] = await Promise.all([
      runGit(['for-each-ref', '--format=%(HEAD)@LIVECODER@%(refname:short)@LIVECODER@%(upstream:short)', 'refs/heads'], cwd),
      runGit(['for-each-ref', '--format=%(HEAD)@LIVECODER@%(refname:short)@LIVECODER@%(upstream:short)', 'refs/remotes'], cwd),
    ]);
    if (local.exitCode !== 0) throw new Error(formatGitError('branch', local));
    if (remote.exitCode !== 0) throw new Error(formatGitError('branch', remote));
    const list: BranchInfo[] = [];
    for (const line of parseForEach(local.stdout)) {
      list.push({ name: line[1], current: line[0] === '*', remote: false, upstream: line[2] || undefined });
    }
    for (const line of parseForEach(remote.stdout)) {
      const head = line[0];
      list.push({ name: line[1], current: false, remote: true, upstream: head === '*' ? line[2] : undefined });
    }
    return list;
  }

  async checkout(workspace: string, branch: string, options: { create?: boolean } = {}): Promise<GitResult> {
    const cwd = await this.resolvePath(workspace);
    const args = ['checkout'];
    if (options.create) args.push('-b');
    args.push(branch);
    const result = await runGit(args, cwd);
    if (result.exitCode !== 0) throw new Error(formatGitError('checkout', result));
    return result;
  }

  async deleteBranch(workspace: string, branch: string, force = false): Promise<GitResult> {
    const cwd = await this.resolvePath(workspace);
    const args = ['branch', force ? '-D' : '-d', branch];
    const result = await runGit(args, cwd);
    if (result.exitCode !== 0) throw new Error(formatGitError('branch -d', result));
    return result;
  }

  async tags(workspace: string): Promise<TagInfo[]> {
    const cwd = await this.resolvePath(workspace);
    const result = await runGit(['for-each-ref', '--format=%(refname:short)@LIVECODER@%(*objectname)@LIVECODER@%(objectname)@LIVECODER@%(subject)', 'refs/tags'], cwd);
    if (result.exitCode !== 0) throw new Error(formatGitError('tag', result));
    return parseForEach(result.stdout).map((line) => {
      const [name, peeled, hash, message] = line;
      return { name, hash: peeled || hash, message: message || undefined };
    });
  }

  async createTag(workspace: string, name: string, message?: string): Promise<GitResult> {
    const cwd = await this.resolvePath(workspace);
    const args = ['tag'];
    if (message) args.push('-a', name, '-m', message);
    else args.push(name);
    const result = await runGit(args, cwd);
    if (result.exitCode !== 0) throw new Error(formatGitError('tag', result));
    return result;
  }

  async deleteTag(workspace: string, name: string): Promise<GitResult> {
    const cwd = await this.resolvePath(workspace);
    const result = await runGit(['tag', '-d', name], cwd);
    if (result.exitCode !== 0) throw new Error(formatGitError('tag -d', result));
    return result;
  }

  async remotes(workspace: string): Promise<RemoteInfo[]> {
    const cwd = await this.resolvePath(workspace);
    const result = await runGit(['remote', '-v'], cwd);
    if (result.exitCode !== 0) throw new Error(formatGitError('remote', result));
    const map = new Map<string, RemoteInfo>();
    for (const line of result.stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
      if (!match) continue;
      const [, name, url, kind] = match;
      const existing = map.get(name) ?? { name, fetchUrl: '', pushUrl: '' };
      if (kind === 'fetch') existing.fetchUrl = url;
      else existing.pushUrl = url;
      map.set(name, existing);
    }
    return Array.from(map.values());
  }

  async addRemote(workspace: string, name: string, url: string): Promise<GitResult> {
    const cwd = await this.resolvePath(workspace);
    const result = await runGit(['remote', 'add', name, url], cwd);
    if (result.exitCode !== 0) throw new Error(formatGitError('remote add', result));
    return result;
  }

  async removeRemote(workspace: string, name: string): Promise<GitResult> {
    const cwd = await this.resolvePath(workspace);
    const result = await runGit(['remote', 'remove', name], cwd);
    if (result.exitCode !== 0) throw new Error(formatGitError('remote remove', result));
    return result;
  }

  async setRemoteUrl(workspace: string, name: string, url: string): Promise<GitResult> {
    const cwd = await this.resolvePath(workspace);
    const result = await runGit(['remote', 'set-url', name, url], cwd);
    if (result.exitCode !== 0) throw new Error(formatGitError('remote set-url', result));
    return result;
  }

  // ponytail: helper for the controller's status endpoint. Returns the
  // configured upstream tracking refs (ahead/behind) for the current branch.
  private async readUpstream(cwd: string, branch: string): Promise<StatusInfo['upstream']> {
    const upstream = await runGit(['rev-parse', '--abbrev-ref', `${branch}@{u}`], cwd);
    if (upstream.exitCode !== 0) return undefined;
    const name = upstream.stdout.trim();
    const counts = await runGit(['rev-list', '--left-right', '--count', `${branch}...${name}`], cwd);
    if (counts.exitCode !== 0) return { name, ahead: 0, behind: 0 };
    const [ahead, behind] = counts.stdout.trim().split(/\s+/).map((n) => Number(n) || 0);
    return { name, ahead, behind };
  }

  private async parsePorcelain(output: string, cwd: string): Promise<DiffFileInfo[]> {
    const lines = output.split('\n').filter(Boolean);
    const files: DiffFileInfo[] = [];
    for (const line of lines) {
      const code = line.slice(0, 2);
      const path = line.slice(3);
      const file = parseStatusCode(code, path);
      if (file) files.push(file);
    }
    return this.annotateStats(files, cwd);
  }

  private async untracked(cwd: string): Promise<DiffFileInfo[]> {
    const result = await runGit(['ls-files', '--others', '--exclude-standard', '-z'], cwd);
    if (result.exitCode !== 0) return [];
    return result.stdout.split('\0').filter(Boolean).map((path) => ({
      path,
      status: 'untracked',
      additions: 0,
      deletions: 0,
      binary: false,
      diff: '',
    }));
  }

  private async annotateStats(files: DiffFileInfo[], cwd: string): Promise<DiffFileInfo[]> {
    if (files.length === 0) return files;
    const args = ['diff', '--no-color', '--numstat', '--'];
    const tracked = files.filter((f) => f.status !== 'untracked').map((f) => f.path);
    if (tracked.length === 0) return files;
    const result = await runGit([...args, ...tracked], cwd);
    if (result.exitCode !== 0) return files;
    const stats = new Map<string, [number, number, boolean]>();
    for (const line of result.stdout.split('\n').filter(Boolean)) {
      const [a, b, path] = line.split('\t');
      const additions = a === '-' ? 0 : Number(a);
      const deletions = b === '-' ? 0 : Number(b);
      const binary = a === '-' && b === '-';
      stats.set(path, [additions, deletions, binary]);
    }
    return files.map((file) => {
      if (file.status === 'untracked') return file;
      const stat = stats.get(file.path) ?? stats.get(file.oldPath ?? '');
      if (!stat) return file;
      const [additions, deletions, binary] = stat;
      return { ...file, additions, deletions, binary };
    });
  }
}

function parseStatusCode(code: string, path: string): DiffFileInfo | null {
  const x = code[0];
  const y = code[1];
  const status = ((): DiffFileInfo['status'] => {
    if (x === '?' && y === '?') return 'untracked';
    if (x === 'A' || y === 'A') return 'added';
    if (x === 'D' || y === 'D') return 'deleted';
    if (x === 'M' || y === 'M') return 'modified';
    if (x === 'R' || y === 'R') return 'renamed';
    if (x === 'C' || y === 'C') return 'copied';
    if (x === 'T' || y === 'T') return 'typechange';
    return 'modified';
  })();
  if (x === '?' && y === '?') return { path, status, additions: 0, deletions: 0, binary: false, diff: '' };
  return { path, status, additions: 0, deletions: 0, binary: false, diff: '' };
}

function parseCommitList(output: string): CommitInfo[] {
  if (!output) return [];
  const records = output.split('\0').filter(Boolean);
  return records.map((record) => {
    const [hash, short, author, email, date, subject, body, refs] = record.split('@LIVECODER@');
    return {
      hash,
      short,
      author,
      email,
      date,
      subject,
      body: body?.trim() || undefined,
      refs: refs?.trim() || undefined,
    };
  });
}

function parseForEach(output: string): string[][] {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('@LIVECODER@'));
}

function parseDiff(statusOut: string, numstatOut: string, patchOut: string, untracked: DiffFileInfo[]): DiffFileInfo[] {
  const stats = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  for (const line of numstatOut.split('\n').filter(Boolean)) {
    const [a, b, path] = line.split('\t');
    const additions = a === '-' ? 0 : Number(a);
    const deletions = b === '-' ? 0 : Number(b);
    const binary = a === '-' && b === '-';
    stats.set(path, { additions, deletions, binary });
  }

  const files: DiffFileInfo[] = [];
  const tokens = statusOut.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    const kind = token[0];
    const path = token.slice(1) || tokens[++i] || '';
    if (!path) continue;
    const stat = stats.get(path) ?? { additions: 0, deletions: 0, binary: false };
    const status = ((): DiffFileInfo['status'] => {
      if (kind === 'A') return 'added';
      if (kind === 'D') return 'deleted';
      if (kind === 'M') return 'modified';
      if (kind === 'T') return 'typechange';
      return 'modified';
    })();
    files.push({ path, status, additions: stat.additions, deletions: stat.deletions, binary: stat.binary, diff: '' });
  }

  // ponytail: split the patch output by `diff --git` headers so each file
  // owns its hunk. Cheap regex keeps the controller off the LALRPOP path.
  const sections = patchOut.split(/^diff --git /m).slice(1);
  for (const section of sections) {
    const headerEnd = section.indexOf('\n');
    const header = section.slice(0, headerEnd);
    const match = header.match(/^a\/(.+?) b\/(.+)$/);
    if (!match) continue;
    const path = match[2];
    const file = files.find((f) => f.path === path);
    if (file) file.diff = section.slice(headerEnd + 1);
  }

  for (const file of untracked) files.push(file);
  return files;
}

function formatGitError(command: string, result: GitResult): string {
  const stderr = result.stderr.trim();
  if (stderr) return stderr;
  return `git ${command} exited with code ${result.exitCode}`;
}
