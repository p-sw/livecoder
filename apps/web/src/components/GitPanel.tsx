// ponytail: one panel, native <details> for collapsible diffs, no extra
// dialog libs. Stage/unstage/restore (unstaged only), remote edit/delete,
// tag push/delete, branch create/delete. Overflow killed with min-w-0 + truncate.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  ChevronDown,
  GitBranch,
  GitCommit,
  GitFork,
  GitMerge,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import {
  git,
  type GitBranchInfo,
  type GitCommitInfo,
  type GitDiffFile,
  type GitRemoteInfo,
  type GitStatus,
  type GitTagInfo,
  type GitCloneResult,
} from '../api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from '../lib/utils';
import { useWorkspaceStore } from '../workspace-context';

export function GitPanel() {
  const { workspace, openFolder } = useWorkspaceStore();
  const workspacePath = workspace?.path ?? null;
  if (!workspacePath) return <aside aria-hidden="true" className="bg-[#0c1219] h-full min-h-0 min-w-0" />;
  return <GitPanelBody workspacePath={workspacePath} openFolder={openFolder} />;
}

function GitPanelBody({
  workspacePath,
  openFolder,
}: {
  workspacePath: string;
  openFolder: (path: string) => Promise<void>;
}) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [log, setLog] = useState<GitCommitInfo[]>([]);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [tags, setTags] = useState<GitTagInfo[]>([]);
  const [remotes, setRemotes] = useState<GitRemoteInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [showClone, setShowClone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [newBranch, setNewBranch] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [newTagMessage, setNewTagMessage] = useState('');
  const [newRemoteName, setNewRemoteName] = useState('');
  const [newRemoteUrl, setNewRemoteUrl] = useState('');
  const [editingRemote, setEditingRemote] = useState<string | null>(null);
  const [editRemoteUrl, setEditRemoteUrl] = useState('');
  const [openCommit, setOpenCommit] = useState<string | null>(null);
  const [commitDetail, setCommitDetail] = useState<{
    hash: string;
    files: GitDiffFile[];
    loading: boolean;
  } | null>(null);
  const [fileDiff, setFileDiff] = useState<{
    key: string;
    path: string;
    staged: boolean;
    text: string;
    loading: boolean;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!workspacePath) return;
    setLoading(true);
    setError(null);
    try {
      const [next, nextLog, nextBranches, nextTags, nextRemotes] = await Promise.all([
        git.status(workspacePath),
        git.log(workspacePath, 30),
        git.branches(workspacePath),
        git.tags(workspacePath),
        git.remotes(workspacePath),
      ]);
      setStatus(next);
      setLog(nextLog);
      setBranches(nextBranches);
      setTags(nextTags);
      setRemotes(nextRemotes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runOp = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      setBusy(label);
      setError(null);
      try {
        await fn();
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const staged = useMemo(() => (status?.files ?? []).filter((f) => f.staged), [status]);
  const unstaged = useMemo(() => (status?.files ?? []).filter((f) => !f.staged), [status]);
  const localBranches = useMemo(() => branches.filter((b) => !b.remote), [branches]);
  const remoteBranches = useMemo(() => branches.filter((b) => b.remote), [branches]);
  const defaultRemote = remotes[0]?.name ?? 'origin';

  const onCommit = () => {
    if (!commitMessage.trim() || staged.length === 0) return;
    void runOp('commit', () =>
      git.commit(workspacePath, commitMessage.trim(), false).then(() => setCommitMessage('')),
    );
  };

  const toggleFileDiff = async (file: GitDiffFile) => {
    const key = `${file.staged ? 'S' : 'U'}:${file.path}`;
    if (fileDiff?.key === key) {
      setFileDiff(null);
      return;
    }
    setFileDiff({ key, path: file.path, staged: file.staged, text: '', loading: true });
    try {
      const files = await git.diff(workspacePath, file.path, file.staged);
      const hit = files.find((f) => f.path === file.path) ?? files[0];
      setFileDiff({
        key,
        path: file.path,
        staged: file.staged,
        text: hit?.binary ? '(binary file)' : hit?.diff || '(no diff)',
        loading: false,
      });
    } catch (err) {
      setFileDiff({
        key,
        path: file.path,
        staged: file.staged,
        text: err instanceof Error ? err.message : String(err),
        loading: false,
      });
    }
  };

  const toggleCommit = async (hash: string) => {
    if (openCommit === hash) {
      setOpenCommit(null);
      setCommitDetail(null);
      return;
    }
    setOpenCommit(hash);
    setCommitDetail({ hash, files: [], loading: true });
    try {
      const detail = await git.show(workspacePath, hash);
      setCommitDetail({ hash, files: detail.files, loading: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCommitDetail(null);
      setOpenCommit(null);
    }
  };

  const saveRemoteUrl = (name: string) => {
    if (!editRemoteUrl.trim()) return;
    void runOp(`set-url ${name}`, () =>
      git.setRemoteUrl(workspacePath, name, editRemoteUrl.trim()).then(() => {
        setEditingRemote(null);
        setEditRemoteUrl('');
      }),
    );
  };

  return (
    <aside className="bg-[#0c1219] flex flex-col h-full min-h-0 min-w-0 overflow-hidden">
      <div className="px-3.5 pl-4 h-16 shrink-0 flex items-center justify-between gap-2 border-b border-border min-w-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 shrink-0 grid place-items-center rounded-md text-blue bg-blue/10">
            <GitBranch size={17} />
          </div>
          <div className="min-w-0">
            <div className="text-subtle font-mono text-[9px] font-medium tracking-[0.13em] leading-none uppercase">
              SOURCE CONTROL
            </div>
            <h2 className="m-0 mt-1 text-fg text-sm font-semibold tracking-[-0.02em] truncate">
              {status?.branch ?? 'Git'}
            </h2>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh"
          className="shrink-0"
        >
          <RefreshCw size={15} className={loading ? 'spin' : ''} />
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 mx-3 mt-2 mb-1 px-2 py-1.5 border border-danger/25 rounded-md text-danger bg-danger/10 font-mono text-[11px] min-w-0">
          <X size={13} className="shrink-0 mt-0.5" />
          <span className="min-w-0 break-words">{error}</span>
          <button
            type="button"
            className="shrink-0 ml-auto border-0 bg-transparent text-danger/80 hover:text-danger p-0"
            onClick={() => setError(null)}
            aria-label="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="flex gap-1.5 px-3 py-2.5 shrink-0 min-w-0">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void runOp('push', () => git.push(workspacePath, { setUpstream: !status?.upstream }))}
          disabled={busy !== null}
          className="flex-1 min-w-0"
        >
          <ArrowUpToLine size={14} /> Push
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void runOp('pull', () => git.pull(workspacePath))}
          disabled={busy !== null}
          className="flex-1 min-w-0"
        >
          <ArrowDownToLine size={14} /> Pull
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void runOp('fetch', () => git.fetch(workspacePath, { prune: true }))}
          disabled={busy !== null}
          className="flex-1 min-w-0"
        >
          <RefreshCw size={14} /> Fetch
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setShowClone(true)} className="flex-1 min-w-0">
          <GitFork size={14} /> Clone
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5 text-subtle font-mono text-[10px] min-w-0 shrink-0">
        {status?.upstream && (
          <span
            className={cn(
              'inline-flex items-center gap-1.5 max-w-full px-1.5 py-0.5 border border-border rounded-full bg-[rgba(255,255,255,0.02)] min-w-0',
              status.upstream.ahead > 0 && 'text-accent',
              status.upstream.behind > 0 && 'text-orange',
            )}
          >
            <GitMerge size={12} className="shrink-0" />
            <span className="truncate">{status.upstream.name}</span>
            {status.upstream.ahead > 0 && <em className="not-italic shrink-0">↑{status.upstream.ahead}</em>}
            {status.upstream.behind > 0 && <em className="not-italic shrink-0">↓{status.upstream.behind}</em>}
          </span>
        )}
        {status && (
          <span className="inline-flex flex-wrap gap-2 min-w-0">
            {status.shortstat.modified > 0 && (
              <em className="not-italic text-orange">{status.shortstat.modified} modified</em>
            )}
            {status.shortstat.added > 0 && (
              <em className="not-italic text-accent">{status.shortstat.added} added</em>
            )}
            {status.shortstat.deleted > 0 && (
              <em className="not-italic text-danger">{status.shortstat.deleted} deleted</em>
            )}
            {status.shortstat.untracked > 0 && (
              <em className="not-italic text-muted">{status.shortstat.untracked} untracked</em>
            )}
            {status.clean && <em className="not-italic text-accent">clean</em>}
          </span>
        )}
        {busy && <em className="not-italic text-blue truncate">…{busy}</em>}
      </div>

      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden ui-scroll-area">
        <Section icon={<GitCommit size={13} />} title="Staged" count={staged.length}>
          {staged.length === 0 && <Empty>No staged changes</Empty>}
          <FileList
            files={staged}
            fileDiff={fileDiff}
            busy={busy !== null}
            onToggle={toggleFileDiff}
            actionLabel="Unstage"
            actionIcon={<Minus size={12} />}
            onAction={(file) => void runOp(`unstage ${file.path}`, () => git.unstage(workspacePath, [file.path]))}
            bulkLabel={staged.length > 0 ? 'Unstage all' : undefined}
            onBulk={
              staged.length > 0
                ? () =>
                    void runOp('unstage all', () =>
                      git.unstage(
                        workspacePath,
                        staged.map((f) => f.path),
                      ),
                    )
                : undefined
            }
          />
        </Section>

        <Section icon={<GitCommit size={13} />} title="Changes" count={unstaged.length}>
          {unstaged.length === 0 && <Empty>No unstaged changes</Empty>}
          <FileList
            files={unstaged}
            fileDiff={fileDiff}
            busy={busy !== null}
            onToggle={toggleFileDiff}
            actionLabel="Stage"
            actionIcon={<Plus size={12} />}
            onAction={(file) => void runOp(`stage ${file.path}`, () => git.stage(workspacePath, [file.path]))}
            bulkLabel={unstaged.length > 0 ? 'Stage all' : undefined}
            onBulk={
              unstaged.length > 0
                ? () =>
                    void runOp('stage all', () =>
                      git.stage(
                        workspacePath,
                        unstaged.map((f) => f.path),
                      ),
                    )
                : undefined
            }
            secondaryLabel="Restore"
            secondaryIcon={<Undo2 size={12} />}
            secondaryDanger
            onSecondary={(file) =>
              void runOp(`restore ${file.path}`, () => git.restore(workspacePath, [file.path]))
            }
            secondaryBulkLabel={unstaged.length > 0 ? 'Restore all' : undefined}
            onSecondaryBulk={
              unstaged.length > 0
                ? () =>
                    void runOp('restore all', () =>
                      git.restore(
                        workspacePath,
                        unstaged.map((f) => f.path),
                      ),
                    )
                : undefined
            }
          />
        </Section>

        <Section icon={<GitCommit size={13} />} title="Commit">
          <div className="flex flex-col gap-1.5 min-w-0">
            <Input
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              placeholder="Commit message"
              className="w-full min-w-0"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) onCommit();
              }}
            />
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-subtle font-mono text-[10px] truncate flex-1 min-w-0">
                {staged.length} staged · {unstaged.length} unstaged
              </span>
              <Button
                variant="default"
                size="sm"
                onClick={onCommit}
                disabled={busy !== null || !commitMessage.trim() || staged.length === 0}
                className="shrink-0"
              >
                <GitCommit size={14} /> Commit
              </Button>
            </div>
          </div>
        </Section>

        <Section icon={<GitBranch size={13} />} title="Branches" count={localBranches.length}>
          <ul className="flex flex-col gap-0.5 p-0 m-0 mb-2 list-none min-w-0">
            {localBranches.map((branch) => (
              <li
                key={branch.name}
                className={cn(
                  'flex items-center gap-1 px-1.5 py-1 rounded min-w-0',
                  branch.current && 'bg-accent/[0.11] text-fg',
                  !branch.current && 'text-muted',
                )}
              >
                <button
                  type="button"
                  onClick={() => void runOp(`checkout ${branch.name}`, () => git.checkout(workspacePath, branch.name))}
                  disabled={branch.current || busy !== null}
                  className="min-w-0 flex-1 flex items-center gap-2 px-0.5 border-0 bg-transparent text-inherit text-left font-mono text-[11px] disabled:cursor-default"
                  title={branch.upstream ? `${branch.name} → ${branch.upstream}` : branch.name}
                >
                  <span className="min-w-0 truncate">{branch.name}</span>
                  {branch.upstream && (
                    <span className="text-subtle text-[10px] truncate shrink min-w-0 max-w-[40%]">
                      {branch.upstream}
                    </span>
                  )}
                </button>
                {!branch.current && (
                  <IconBtn
                    label="Delete branch"
                    danger
                    disabled={busy !== null}
                    onClick={() =>
                      void runOp(`delete ${branch.name}`, () => git.deleteBranch(workspacePath, branch.name, true))
                    }
                  >
                    <Trash2 size={12} />
                  </IconBtn>
                )}
              </li>
            ))}
          </ul>
          {remoteBranches.length > 0 && (
            <details className="mb-2 min-w-0">
              <summary className="cursor-pointer text-subtle font-mono text-[10px] uppercase tracking-[0.08em] select-none">
                Remote ({remoteBranches.length})
              </summary>
              <ul className="flex flex-col gap-0.5 p-0 m-0 mt-1 list-none min-w-0">
                {remoteBranches.map((branch) => (
                  <li key={branch.name} className="flex items-center gap-1 px-1.5 py-1 rounded text-muted min-w-0">
                    <button
                      type="button"
                      onClick={() =>
                        void runOp(`checkout ${branch.name}`, () => git.checkout(workspacePath, branch.name))
                      }
                      disabled={busy !== null}
                      className="min-w-0 flex-1 truncate px-0.5 border-0 bg-transparent text-inherit text-left font-mono text-[11px]"
                      title={branch.name}
                    >
                      {branch.name}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex gap-1.5 min-w-0">
            <Input
              value={newBranch}
              onChange={(event) => setNewBranch(event.target.value)}
              placeholder="New branch"
              className="flex-1 min-w-0"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && newBranch.trim()) {
                  const name = newBranch.trim();
                  void runOp(`create ${name}`, () =>
                    git.checkout(workspacePath, name, true).then(() => setNewBranch('')),
                  );
                }
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => {
                if (!newBranch.trim()) return;
                const name = newBranch.trim();
                void runOp(`create ${name}`, () =>
                  git.checkout(workspacePath, name, true).then(() => setNewBranch('')),
                );
              }}
              disabled={busy !== null || !newBranch.trim()}
            >
              Create
            </Button>
          </div>
        </Section>

        <Section icon={<Tag size={13} />} title="Tags" count={tags.length}>
          {tags.length === 0 && <Empty>No tags</Empty>}
          <ul className="flex flex-col gap-0.5 p-0 m-0 mb-2 list-none min-w-0">
            {tags.map((tag) => (
              <li key={tag.name} className="flex items-center gap-1 px-1.5 py-1 rounded text-muted min-w-0">
                <div className="min-w-0 flex-1 flex items-center gap-1.5">
                  <span className="min-w-0 truncate font-mono text-[11px]" title={tag.message || tag.name}>
                    {tag.name}
                  </span>
                  <span className="text-subtle text-[10px] shrink-0 font-mono">{tag.hash.slice(0, 7)}</span>
                </div>
                <IconBtn
                  label="Push tag"
                  disabled={busy !== null || remotes.length === 0}
                  onClick={() =>
                    void runOp(`push tag ${tag.name}`, () => git.pushTag(workspacePath, tag.name, defaultRemote))
                  }
                >
                  <Upload size={12} />
                </IconBtn>
                <IconBtn
                  label="Delete local tag"
                  danger
                  disabled={busy !== null}
                  onClick={() => void runOp(`delete tag ${tag.name}`, () => git.deleteTag(workspacePath, tag.name))}
                >
                  <Trash2 size={12} />
                </IconBtn>
                <IconBtn
                  label="Delete remote tag"
                  danger
                  disabled={busy !== null || remotes.length === 0}
                  onClick={() =>
                    void runOp(`delete remote tag ${tag.name}`, () =>
                      git.deleteTag(workspacePath, tag.name, { remote: defaultRemote, remoteOnly: true }),
                    )
                  }
                >
                  <X size={12} />
                </IconBtn>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex gap-1.5 min-w-0">
              <Input
                value={newTagName}
                onChange={(event) => setNewTagName(event.target.value)}
                placeholder="Tag name"
                className="flex-1 min-w-0"
              />
              <Input
                value={newTagMessage}
                onChange={(event) => setNewTagMessage(event.target.value)}
                placeholder="Message (optional)"
                className="flex-1 min-w-0"
              />
            </div>
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  if (!newTagName.trim()) return;
                  const name = newTagName.trim();
                  const message = newTagMessage.trim() || undefined;
                  void runOp(`tag ${name}`, () =>
                    git.createTag(workspacePath, name, message).then(() => {
                      setNewTagName('');
                      setNewTagMessage('');
                    }),
                  );
                }}
                disabled={busy !== null || !newTagName.trim()}
              >
                Create
              </Button>
            </div>
          </div>
        </Section>

        <Section icon={<GitFork size={13} />} title="Remotes" count={remotes.length}>
          {remotes.length === 0 && <Empty>No remotes</Empty>}
          <ul className="flex flex-col gap-1 p-0 m-0 mb-2 list-none min-w-0">
            {remotes.map((remote) => (
              <li key={remote.name} className="flex flex-col gap-1 px-1.5 py-1.5 rounded text-muted min-w-0 border border-transparent hover:border-border/60">
                {editingRemote === remote.name ? (
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <div className="font-mono text-[11px] text-fg truncate">{remote.name}</div>
                    <Input
                      value={editRemoteUrl}
                      onChange={(event) => setEditRemoteUrl(event.target.value)}
                      placeholder="https://…"
                      className="w-full min-w-0"
                      autoFocus
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') saveRemoteUrl(remote.name);
                        if (event.key === 'Escape') {
                          setEditingRemote(null);
                          setEditRemoteUrl('');
                        }
                      }}
                    />
                    <div className="flex gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingRemote(null);
                          setEditRemoteUrl('');
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        disabled={busy !== null || !editRemoteUrl.trim()}
                        onClick={() => saveRemoteUrl(remote.name)}
                      >
                        <Check size={12} /> Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 min-w-0">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[11px] text-fg truncate">{remote.name}</div>
                      <div className="font-mono text-[10px] text-subtle truncate" title={remote.fetchUrl}>
                        {remote.fetchUrl}
                      </div>
                    </div>
                    <IconBtn
                      label="Edit remote URL"
                      disabled={busy !== null}
                      onClick={() => {
                        setEditingRemote(remote.name);
                        setEditRemoteUrl(remote.fetchUrl);
                      }}
                    >
                      <Pencil size={12} />
                    </IconBtn>
                    <IconBtn
                      label="Delete remote"
                      danger
                      disabled={busy !== null}
                      onClick={() =>
                        void runOp(`remove remote ${remote.name}`, () => git.removeRemote(workspacePath, remote.name))
                      }
                    >
                      <Trash2 size={12} />
                    </IconBtn>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex gap-1.5 min-w-0">
              <Input
                value={newRemoteName}
                onChange={(event) => setNewRemoteName(event.target.value)}
                placeholder="Name"
                className="w-[30%] min-w-0 shrink-0"
              />
              <Input
                value={newRemoteUrl}
                onChange={(event) => setNewRemoteUrl(event.target.value)}
                placeholder="https://example.com/repo.git"
                className="flex-1 min-w-0"
              />
            </div>
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  if (!newRemoteName.trim() || !newRemoteUrl.trim()) return;
                  const name = newRemoteName.trim();
                  const url = newRemoteUrl.trim();
                  void runOp(`add remote ${name}`, () =>
                    git.addRemote(workspacePath, name, url).then(() => {
                      setNewRemoteName('');
                      setNewRemoteUrl('');
                    }),
                  );
                }}
                disabled={busy !== null || !newRemoteName.trim() || !newRemoteUrl.trim()}
              >
                Add
              </Button>
            </div>
          </div>
        </Section>

        <Section icon={<GitCommit size={13} />} title="History" count={log.length}>
          <ul className="flex flex-col gap-0.5 p-0 m-0 list-none min-w-0">
            {log.map((commit) => {
              const open = openCommit === commit.hash;
              const detail = open && commitDetail?.hash === commit.hash ? commitDetail : null;
              return (
                <li key={commit.hash} className="border-b border-[rgba(32,45,58,0.5)] last:border-b-0 min-w-0">
                  <button
                    type="button"
                    onClick={() => void toggleCommit(commit.hash)}
                    className="w-full min-w-0 flex flex-col gap-0.5 px-1 py-1.5 border-0 bg-transparent text-left hover:bg-[rgba(255,255,255,0.03)] rounded"
                  >
                    <div className="flex items-baseline gap-2 text-fg font-mono text-[11px] min-w-0">
                      <ChevronDown
                        size={12}
                        className={cn('shrink-0 text-subtle transition-transform', open ? 'rotate-0' : '-rotate-90')}
                      />
                      <span className="text-accent shrink-0">{commit.short}</span>
                      <span className="min-w-0 truncate">{commit.subject}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 pl-5 text-subtle font-mono text-[9px] min-w-0">
                      <span className="truncate max-w-[40%]">{commit.author}</span>
                      <span className="shrink-0">{new Date(commit.date).toLocaleString()}</span>
                      {commit.refs && <span className="text-blue truncate">{commit.refs}</span>}
                    </div>
                  </button>
                  {open && (
                    <div className="ml-5 mb-2 mr-1 border border-border rounded-md bg-[#0a1018] overflow-hidden min-w-0">
                      {commit.body && (
                        <pre className="m-0 px-2.5 py-2 border-b border-border text-muted font-mono text-[10px] whitespace-pre-wrap break-words">
                          {commit.body}
                        </pre>
                      )}
                      {detail?.loading && (
                        <p className="m-0 px-2.5 py-2 text-subtle font-mono text-[10px]">Loading diff…</p>
                      )}
                      {detail && !detail.loading && detail.files.length === 0 && (
                        <p className="m-0 px-2.5 py-2 text-subtle font-mono text-[10px]">No file changes</p>
                      )}
                      {detail &&
                        !detail.loading &&
                        detail.files.map((file) => (
                          <details key={file.path} className="border-t border-border first:border-t-0 min-w-0 group">
                            <summary className="cursor-pointer list-none flex items-center gap-2 px-2.5 py-1.5 font-mono text-[10px] text-muted hover:bg-[rgba(255,255,255,0.03)] min-w-0">
                              <StatusBadge status={file.status} />
                              <span className="min-w-0 truncate flex-1" title={file.path}>
                                {file.path}
                              </span>
                              <span className="shrink-0 inline-flex gap-1">
                                {file.additions > 0 && <em className="not-italic text-accent">+{file.additions}</em>}
                                {file.deletions > 0 && <em className="not-italic text-danger">-{file.deletions}</em>}
                              </span>
                            </summary>
                            <pre className="m-0 max-h-[220px] px-2.5 py-2 overflow-auto text-muted font-mono text-[10px] leading-[1.45] whitespace-pre border-t border-border/60">
                              {file.binary ? '(binary file)' : file.diff || '(no diff)'}
                            </pre>
                          </details>
                        ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      </div>

      {showClone && (
        <CloneDialog
          onClose={() => setShowClone(false)}
          onCloned={(result) => {
            setShowClone(false);
            void openFolder(result.path);
          }}
        />
      )}
    </aside>
  );
}

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: ReactNode;
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="px-3.5 py-2.5 pb-5 border-t border-[rgba(32,45,58,0.7)] min-w-0">
      <h3 className="flex items-center gap-1.5 m-0 mb-2 text-fg font-mono text-[9px] font-medium tracking-[0.13em] uppercase min-w-0">
        {icon}
        <span className="truncate">{title}</span>
        {typeof count === 'number' && (
          <span className="ml-auto text-subtle normal-case tracking-normal font-mono text-[10px]">{count}</span>
        )}
      </h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 mb-2 text-subtle text-[11px]">{children}</p>;
}

function FileList({
  files,
  fileDiff,
  busy,
  onToggle,
  actionLabel,
  actionIcon,
  onAction,
  bulkLabel,
  onBulk,
  secondaryLabel,
  secondaryIcon,
  onSecondary,
  secondaryDanger,
  secondaryBulkLabel,
  onSecondaryBulk,
}: {
  files: GitDiffFile[];
  fileDiff: { key: string; path: string; staged: boolean; text: string; loading: boolean } | null;
  busy: boolean;
  onToggle: (file: GitDiffFile) => void;
  actionLabel: string;
  actionIcon: ReactNode;
  onAction: (file: GitDiffFile) => void;
  bulkLabel?: string;
  onBulk?: () => void;
  secondaryLabel?: string;
  secondaryIcon?: ReactNode;
  onSecondary?: (file: GitDiffFile) => void;
  secondaryDanger?: boolean;
  secondaryBulkLabel?: string;
  onSecondaryBulk?: () => void;
}) {
  return (
    <div className="min-w-0">
      {(bulkLabel && onBulk) || (secondaryBulkLabel && onSecondaryBulk) ? (
        <div className="flex justify-end gap-2 mb-1">
          {secondaryBulkLabel && onSecondaryBulk && (
            <button
              type="button"
              onClick={onSecondaryBulk}
              disabled={busy}
              className="border-0 bg-transparent text-subtle hover:text-danger font-mono text-[10px] px-1 py-0.5 disabled:opacity-50"
            >
              {secondaryBulkLabel}
            </button>
          )}
          {bulkLabel && onBulk && (
            <button
              type="button"
              onClick={onBulk}
              disabled={busy}
              className="border-0 bg-transparent text-subtle hover:text-fg font-mono text-[10px] px-1 py-0.5 disabled:opacity-50"
            >
              {bulkLabel}
            </button>
          )}
        </div>
      ) : null}
      <ul className="flex flex-col gap-0.5 p-0 m-0 list-none min-w-0">
        {files.map((file) => {
          const key = `${file.staged ? 'S' : 'U'}:${file.path}`;
          const open = fileDiff?.key === key;
          return (
            <li key={key} className="min-w-0">
              <div className="flex items-center gap-0.5 min-w-0">
                <button
                  type="button"
                  className={cn(
                    'min-w-0 flex-1 flex items-center gap-2 px-1.5 py-1.5 border-0 rounded bg-transparent text-left text-muted font-mono text-[11px] hover:bg-[rgba(255,255,255,0.03)]',
                    open && 'bg-accent/[0.11] text-fg',
                  )}
                  onClick={() => onToggle(file)}
                  title={file.path}
                >
                  <StatusBadge status={file.status} />
                  <span className="min-w-0 truncate">{file.path}</span>
                  <span className="inline-flex gap-1 ml-auto shrink-0 font-mono text-[10px]">
                    {file.additions > 0 && <em className="not-italic text-accent">+{file.additions}</em>}
                    {file.deletions > 0 && <em className="not-italic text-danger">-{file.deletions}</em>}
                  </span>
                </button>
                {secondaryLabel && secondaryIcon && onSecondary && (
                  <IconBtn
                    label={secondaryLabel}
                    danger={secondaryDanger}
                    disabled={busy}
                    onClick={() => onSecondary(file)}
                  >
                    {secondaryIcon}
                  </IconBtn>
                )}
                <IconBtn label={actionLabel} disabled={busy} onClick={() => onAction(file)}>
                  {actionIcon}
                </IconBtn>
              </div>
              {open && (
                <pre className="mt-0.5 mb-1 ml-1 mr-0 max-h-[240px] px-2.5 py-2 overflow-auto border border-border rounded-md bg-[#0a1018] text-muted font-mono text-[10px] leading-[1.45] whitespace-pre min-w-0">
                  {fileDiff.loading ? 'Loading…' : fileDiff.text}
                </pre>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StatusBadge({ status }: { status: GitDiffFile['status'] }) {
  return (
    <span
      className={cn(
        'w-[18px] h-[18px] grid place-items-center rounded text-[#07120d] text-[10px] font-bold shrink-0',
        status === 'added' && 'bg-accent',
        status === 'modified' && 'bg-orange',
        status === 'deleted' && 'bg-danger',
        status === 'untracked' && 'bg-muted',
        status === 'renamed' && 'bg-blue',
        (status === 'copied' || status === 'typechange') && 'bg-purple',
      )}
    >
      {status[0]?.toUpperCase()}
    </span>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
  danger,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'w-[22px] h-[22px] shrink-0 grid place-items-center border-0 rounded bg-transparent text-subtle disabled:opacity-40',
        danger ? 'hover:bg-[rgba(255,141,155,0.08)] hover:text-danger' : 'hover:bg-[rgba(255,255,255,0.06)] hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

function CloneDialog({
  onClose,
  onCloned,
}: {
  onClose: () => void;
  onCloned: (result: GitCloneResult) => void;
}) {
  const [url, setUrl] = useState('');
  const [path, setPath] = useState('');
  const [suggestion, setSuggestion] = useState<{ parent: string; source: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const inferred = url.includes('/') ? (url.split('/').pop()?.replace(/\.git$/, '') ?? '') : '';
    void git.suggestClonePath(inferred).then(setSuggestion).catch(() => undefined);
  }, [url]);

  const submit = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await git.clone(url.trim(), path.trim() || undefined);
      onCloned(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed z-20 inset-0 grid place-items-center p-5 bg-[rgba(3,6,9,0.7)] backdrop-blur-md max-md:items-end max-md:p-0"
    >
      <div className="w-full max-w-[520px] max-h-[min(690px,calc(100dvh-40px))] flex flex-col border border-border-bright rounded-[13px] bg-[#101821] shadow-[0_24px_80px_rgba(0,0,0,0.5),0_0_0_1px_rgba(141,244,189,0.035)] overflow-hidden max-md:w-full max-md:max-h-[92dvh] max-md:border-b-0 max-md:rounded-t-[15px] min-w-0">
        <div className="flex items-start justify-between gap-2 px-5 pt-5 pb-4 border-b border-border min-w-0">
          <div className="min-w-0">
            <div className="text-subtle font-mono text-[9px] font-medium tracking-[0.13em] leading-none uppercase">
              CLONE REPOSITORY
            </div>
            <h2 className="m-0 mt-2 text-fg text-[19px] font-semibold tracking-[-0.04em]">Clone a git repository</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="shrink-0">
            <X size={16} />
          </Button>
        </div>
        <div className="flex flex-col gap-3 px-5 py-3 min-w-0">
          <label className="flex flex-col gap-2 min-w-0">
            <span className="text-subtle font-mono text-[10px] tracking-[0.13em] uppercase">URL</span>
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://github.com/owner/repo.git"
              autoFocus
              className="min-w-0"
            />
          </label>
          <label className="flex flex-col gap-2 min-w-0">
            <span className="text-subtle font-mono text-[10px] tracking-[0.13em] uppercase">Destination path</span>
            <Input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder={suggestion ? `${suggestion.parent}/<name>` : '/path/to/destination'}
              className="min-w-0"
            />
          </label>
          {suggestion && (
            <p className="m-0 text-subtle text-[11px] break-words">
              Default:{' '}
              <code className="px-1 py-px border border-border rounded text-fg font-mono text-[10px] break-all">
                {suggestion.parent}
              </code>{' '}
              ({sourceLabel(suggestion.source)})
            </p>
          )}
          {error && <p className="m-0 text-danger text-[11px] break-words">{error}</p>}
        </div>
        <div className="flex items-center justify-between gap-2.5 px-5 pt-3.5 pb-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" onClick={() => void submit()} disabled={busy || !url.trim()}>
            {busy ? 'Cloning…' : 'Clone'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function sourceLabel(source: string): string {
  if (source === 'env') return 'BASE_CLONE_PATH';
  if (source === 'history') return 'previous clone parent';
  if (source === 'home') return 'home directory';
  return source;
}
