// ponytail: full Tailwind migration. The previous version relied on
// .git-* / .count-* / .upstream-* rules in styles.css — those are
// gone, so every layout, color, and spacing utility is inlined here.
// The CloneDialog at the bottom uses the same dialog layout as the
// WorkspacePicker (bg-[rgba(3,6,9,0.7)] backdrop) so the two modals
// look the same.

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  GitBranch,
  GitCommit,
  GitFork,
  GitMerge,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { git, type GitBranchInfo, type GitCommitInfo, type GitDiffFile, type GitRemoteInfo, type GitStatus, type GitTagInfo, type GitCloneResult } from '../api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { cn } from '../lib/utils';
import { useWorkspaceStore } from '../workspace-context';

export function GitPanel() {
  const { workspace, openFolder } = useWorkspaceStore();
  const workspacePath = workspace?.path ?? null;
  if (!workspacePath) return <EmptyGitPanel />;
  return <GitPanelBody workspacePath={workspacePath} openFolder={openFolder} />;
}

function EmptyGitPanel() {
  return <aside aria-hidden="true" className="bg-[#0c1219] h-full" />;
}

function GitPanelBody({ workspacePath, openFolder }: { workspacePath: string; openFolder: (path: string) => Promise<void> }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [log, setLog] = useState<GitCommitInfo[]>([]);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [tags, setTags] = useState<GitTagInfo[]>([]);
  const [remotes, setRemotes] = useState<GitRemoteInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<GitDiffFile | null>(null);
  const [showClone, setShowClone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [newBranch, setNewBranch] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [newTagMessage, setNewTagMessage] = useState('');
  const [newRemoteName, setNewRemoteName] = useState('');
  const [newRemoteUrl, setNewRemoteUrl] = useState('');

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
      if (selectedFile && !next.files.find((f) => f.path === selectedFile.path)) {
        setSelectedFile(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workspacePath, selectedFile]);

  useEffect(() => { void refresh(); }, [refresh]);

  const runOp = useCallback(async (label: string, fn: () => Promise<unknown>) => {
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
  }, [refresh]);

  const onCommit = () => {
    if (!commitMessage.trim()) return;
    void runOp('commit', () => git.commit(workspacePath, commitMessage.trim(), true).then(() => setCommitMessage('')));
  };

  const onPush = () => runOp('push', () => git.push(workspacePath, { setUpstream: !status?.upstream }));
  const onPull = () => runOp('pull', () => git.pull(workspacePath));
  const onFetch = () => runOp('fetch', () => git.fetch(workspacePath, { prune: true }));

  const onCheckout = (branch: string) => runOp(`checkout ${branch}`, () => git.checkout(workspacePath, branch));
  const onCreateBranch = () => {
    if (!newBranch.trim()) return;
    const name = newBranch.trim();
    void runOp(`create ${name}`, () => git.checkout(workspacePath, name, true).then(() => setNewBranch('')));
  };
  const onDeleteBranch = (branch: string) => runOp(`delete ${branch}`, () => git.deleteBranch(workspacePath, branch, true));

  const onCreateTag = () => {
    if (!newTagName.trim()) return;
    const name = newTagName.trim();
    const message = newTagMessage.trim() || undefined;
    void runOp(`tag ${name}`, () => git.createTag(workspacePath, name, message).then(() => {
      setNewTagName('');
      setNewTagMessage('');
    }));
  };
  const onDeleteTag = (name: string) => runOp(`delete tag ${name}`, () => git.deleteTag(workspacePath, name));

  const onAddRemote = () => {
    if (!newRemoteName.trim() || !newRemoteUrl.trim()) return;
    const name = newRemoteName.trim();
    const url = newRemoteUrl.trim();
    void runOp(`add remote ${name}`, () => git.addRemote(workspacePath, name, url).then(() => {
      setNewRemoteName('');
      setNewRemoteUrl('');
    }));
  };
  const onRemoveRemote = (name: string) => runOp(`remove remote ${name}`, () => git.removeRemote(workspacePath, name));

  return (
    <aside className="bg-[#0c1219] flex flex-col h-full">
      <div className="px-3.5 pl-4 h-16 shrink-0 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 grid place-items-center rounded-md text-blue bg-blue/10">
            <GitBranch size={17} />
          </div>
          <div>
            <div className="text-subtle font-mono text-[9px] font-medium tracking-[0.13em] leading-none uppercase">SOURCE CONTROL</div>
            <h2 className="m-0 mt-1 text-fg text-sm font-semibold tracking-[-0.02em]">{status?.branch ?? 'Git'}</h2>
          </div>
        </div>
        <div className="ml-auto flex gap-0.5">
          <Button variant="ghost" size="icon" onClick={() => void refresh()} disabled={loading} aria-label="Refresh">
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 mx-3 mb-2 px-2 py-1.5 border border-danger/25 rounded-md text-danger bg-danger/10 font-mono text-[11px]">
          <X size={13} /><span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 px-3 pr-3 pb-2.5">
        <Button variant="secondary" size="sm" onClick={onPush} disabled={busy !== null} className="flex-1 min-w-0"><ArrowUpToLine size={14} /> Push</Button>
        <Button variant="secondary" size="sm" onClick={onPull} disabled={busy !== null} className="flex-1 min-w-0"><ArrowDownToLine size={14} /> Pull</Button>
        <Button variant="ghost" size="sm" onClick={onFetch} disabled={busy !== null} className="flex-1 min-w-0"><RefreshCw size={14} /> Fetch</Button>
        <Button variant="ghost" size="sm" onClick={() => setShowClone(true)} className="flex-1 min-w-0"><GitFork size={14} /> Clone</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5 text-subtle font-mono text-[10px]">
        {status?.upstream && (
          <span className={cn(
            'inline-flex items-center gap-1.5 px-1.5 py-0.5 border border-border rounded-full bg-[rgba(255,255,255,0.02)]',
            status.upstream.ahead > 0 && 'text-accent',
            status.upstream.behind > 0 && 'text-orange',
          )}>
            <GitMerge size={12} />
            {status.upstream.name}
            {status.upstream.ahead > 0 && <em className="not-italic">↑{status.upstream.ahead}</em>}
            {status.upstream.behind > 0 && <em className="not-italic">↓{status.upstream.behind}</em>}
          </span>
        )}
        {status && (
          <span className="inline-flex flex-wrap gap-2">
            {status.shortstat.modified > 0 && <em className="not-italic text-orange">{status.shortstat.modified} modified</em>}
            {status.shortstat.added > 0 && <em className="not-italic text-accent">{status.shortstat.added} added</em>}
            {status.shortstat.deleted > 0 && <em className="not-italic text-danger">{status.shortstat.deleted} deleted</em>}
            {status.shortstat.untracked > 0 && <em className="not-italic text-muted">{status.shortstat.untracked} untracked</em>}
            {status.clean && <em className="not-italic text-accent">clean</em>}
          </span>
        )}
      </div>

      <ScrollArea className="ui-scroll-area">
        <section className="px-[18px] py-2.5 pb-6 border-t border-[rgba(32,45,58,0.7)]">
          <h3 className="flex items-center gap-1.5 m-0 mb-2 text-fg font-mono text-[9px] font-medium tracking-[0.13em] uppercase">
            <GitCommit size={13} /> Changes
          </h3>
          {status && status.files.length === 0 && <p className="m-0 text-subtle text-[11px]">No changes</p>}
          <ul className="flex flex-col gap-0.5 p-0 m-0 mb-2 list-none">
            {(status?.files ?? []).map((file) => (
              <li key={`${file.status}:${file.path}`} className="flex items-center gap-1">
                <button
                  type="button"
                  className={cn(
                    'min-w-0 flex-1 flex items-center gap-2 px-2 py-1.5 border-0 rounded bg-transparent text-left text-muted font-mono text-[11px]',
                    selectedFile?.path === file.path && 'bg-accent/[0.11] text-fg',
                  )}
                  onClick={() => setSelectedFile(file)}
                >
                  <span className={cn(
                    'w-[18px] h-[18px] grid place-items-center rounded text-[#07120d] text-[10px] font-bold flex-shrink-0',
                    file.status === 'added' && 'bg-accent',
                    file.status === 'modified' && 'bg-orange',
                    file.status === 'deleted' && 'bg-danger',
                    file.status === 'untracked' && 'bg-muted',
                    file.status === 'renamed' && 'bg-blue',
                    (file.status === 'copied' || file.status === 'typechange') && 'bg-purple',
                  )}>
                    {file.status[0]?.toUpperCase()}
                  </span>
                  <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={file.path}>{file.path}</span>
                  <span className="inline-flex gap-1 ml-auto font-mono text-[10px]">
                    {file.additions > 0 && <em className="not-italic text-accent">+{file.additions}</em>}
                    {file.deletions > 0 && <em className="not-italic text-danger">-{file.deletions}</em>}
                  </span>
                </button>
                <div className="flex">
                  <button
                    type="button"
                    onClick={() => void runOp(`stage ${file.path}`, () => git.stage(workspacePath, [file.path]))}
                    title="Stage"
                    className="w-[22px] h-[22px] grid place-items-center border-0 rounded bg-transparent text-subtle hover:bg-[rgba(255,255,255,0.06)] hover:text-fg"
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {selectedFile && (
            <div className="mt-2 border border-border rounded-md bg-[#0a1018] overflow-hidden">
              <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border text-fg font-mono text-[10px]">
                <strong className="truncate">{selectedFile.path}</strong>
                <span className="text-[10px] uppercase tracking-[0.05em] text-muted">{selectedFile.status}</span>
              </div>
              <pre className="max-h-[280px] m-0 px-2.5 py-2 overflow-auto text-muted font-mono text-[10px] leading-[1.5] whitespace-pre">
                {selectedFile.binary ? '(binary file)' : selectedFile.diff || '(no diff)'}
              </pre>
            </div>
          )}
        </section>

        <section className="px-[18px] py-2.5 pb-6 border-t border-[rgba(32,45,58,0.7)]">
          <h3 className="flex items-center gap-1.5 m-0 mb-2 text-fg font-mono text-[9px] font-medium tracking-[0.13em] uppercase">
            <GitCommit size={13} /> Commit
          </h3>
          <div className="flex gap-1.5">
            <Input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Commit message" className="flex-1" />
            <Button variant="default" size="sm" onClick={onCommit} disabled={busy !== null || !commitMessage.trim() || !status || status.clean}>
              <GitCommit size={14} /> Commit
            </Button>
          </div>
        </section>

        <section className="px-[18px] py-2.5 pb-6 border-t border-[rgba(32,45,58,0.7)]">
          <h3 className="flex items-center gap-1.5 m-0 mb-2 text-fg font-mono text-[9px] font-medium tracking-[0.13em] uppercase">
            <GitBranch size={13} /> Branches
          </h3>
          <ul className="flex flex-col gap-0.5 p-0 m-0 mb-2 list-none">
            {branches.filter((branch) => !branch.remote).map((branch) => (
              <li
                key={branch.name}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1 rounded text-muted',
                  branch.current && 'bg-accent/[0.11] text-fg',
                )}
              >
                <button
                  type="button"
                  onClick={() => onCheckout(branch.name)}
                  disabled={branch.current || busy !== null}
                  className="min-w-0 flex-1 flex items-center gap-2 px-0 border-0 bg-transparent text-inherit text-left font-mono text-[11px] disabled:cursor-default"
                >
                  <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{branch.name}</span>
                  {branch.upstream && <span className="text-subtle text-[10px]">{branch.upstream}</span>}
                </button>
                {!branch.current && (
                  <button
                    type="button"
                    onClick={() => onDeleteBranch(branch.name)}
                    disabled={busy !== null}
                    aria-label="Delete branch"
                    className="w-[22px] h-[22px] grid place-items-center border-0 rounded bg-transparent text-subtle hover:bg-[rgba(255,141,155,0.08)] hover:text-danger"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1.5">
            <Input value={newBranch} onChange={(event) => setNewBranch(event.target.value)} placeholder="New branch" className="flex-1 min-w-0" />
            <Button variant="ghost" size="sm" onClick={onCreateBranch} disabled={busy !== null || !newBranch.trim()}>Create</Button>
          </div>
        </section>

        <section className="px-[18px] py-2.5 pb-6 border-t border-[rgba(32,45,58,0.7)]">
          <h3 className="flex items-center gap-1.5 m-0 mb-2 text-fg font-mono text-[9px] font-medium tracking-[0.13em] uppercase">
            <Tag size={13} /> Tags
          </h3>
          {tags.length === 0 && <p className="m-0 text-subtle text-[11px]">No tags</p>}
          <ul className="flex flex-col gap-0.5 p-0 m-0 mb-2 list-none">
            {tags.map((tag) => (
              <li key={tag.name} className="flex items-center gap-1.5 px-2 py-1 rounded text-muted">
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{tag.name}</span>
                <span className="text-subtle text-[10px]">{tag.hash.slice(0, 7)}</span>
                <button
                  type="button"
                  onClick={() => onDeleteTag(tag.name)}
                  disabled={busy !== null}
                  aria-label="Delete tag"
                  className="ml-auto w-[22px] h-[22px] grid place-items-center border-0 rounded bg-transparent text-subtle hover:bg-[rgba(255,141,155,0.08)] hover:text-danger"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1.5">
            <Input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} placeholder="Tag name" className="flex-1 min-w-0" />
            <Input value={newTagMessage} onChange={(event) => setNewTagMessage(event.target.value)} placeholder="Message (optional)" className="flex-1 min-w-0" />
            <Button variant="ghost" size="sm" onClick={onCreateTag} disabled={busy !== null || !newTagName.trim()}>Create</Button>
          </div>
        </section>

        <section className="px-[18px] py-2.5 pb-6 border-t border-[rgba(32,45,58,0.7)]">
          <h3 className="flex items-center gap-1.5 m-0 mb-2 text-fg font-mono text-[9px] font-medium tracking-[0.13em] uppercase">
            <GitFork size={13} /> Remotes
          </h3>
          {remotes.length === 0 && <p className="m-0 text-subtle text-[11px]">No remotes</p>}
          <ul className="flex flex-col gap-0.5 p-0 m-0 mb-2 list-none">
            {remotes.map((remote) => (
              <li key={remote.name} className="flex items-center gap-1.5 px-2 py-1 rounded text-muted">
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{remote.name}</span>
                <span className="text-subtle text-[10px]">{remote.fetchUrl}</span>
                <button
                  type="button"
                  onClick={() => onRemoveRemote(remote.name)}
                  disabled={busy !== null}
                  aria-label="Remove remote"
                  className="ml-auto w-[22px] h-[22px] grid place-items-center border-0 rounded bg-transparent text-subtle hover:bg-[rgba(255,141,155,0.08)] hover:text-danger"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1.5">
            <Input value={newRemoteName} onChange={(event) => setNewRemoteName(event.target.value)} placeholder="Name" className="flex-1 min-w-0" />
            <Input value={newRemoteUrl} onChange={(event) => setNewRemoteUrl(event.target.value)} placeholder="https://example.com/repo.git" className="flex-1 min-w-0" />
            <Button variant="ghost" size="sm" onClick={onAddRemote} disabled={busy !== null || !newRemoteName.trim() || !newRemoteUrl.trim()}>Add</Button>
          </div>
        </section>

        <section className="px-[18px] py-2.5 pb-6 border-t border-[rgba(32,45,58,0.7)]">
          <h3 className="flex items-center gap-1.5 m-0 mb-2 text-fg font-mono text-[9px] font-medium tracking-[0.13em] uppercase">
            <GitCommit size={13} /> History
          </h3>
          <ul className="flex flex-col gap-1 p-0 m-0 list-none">
            {log.map((commit) => (
              <li key={commit.hash} className="py-1.5 border-b border-[rgba(32,45,58,0.5)] last:border-b-0">
                <div className="flex items-baseline gap-2 text-fg font-mono text-[11px]">
                  <span className="text-accent flex-shrink-0">{commit.short}</span>
                  <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{commit.subject}</span>
                </div>
                <div className="flex gap-2 mt-0.5 text-subtle font-mono text-[9px]">
                  <span>{commit.author}</span>
                  <span>{new Date(commit.date).toLocaleString()}</span>
                  {commit.refs && <span className="text-blue">{commit.refs}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </ScrollArea>

      {showClone && (
        <CloneDialog
          onClose={() => setShowClone(false)}
          onCloned={(result) => { setShowClone(false); void openFolder(result.path); }}
        />
      )}
    </aside>
  );
}

interface CloneDialogProps {
  onClose: () => void;
  onCloned: (result: GitCloneResult) => void;
}

function CloneDialog({ onClose, onCloned }: CloneDialogProps) {
  const [url, setUrl] = useState('');
  const [path, setPath] = useState('');
  const [suggestion, setSuggestion] = useState<{ parent: string; source: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const inferred = url.includes('/') ? url.split('/').pop()?.replace(/\.git$/, '') ?? '' : '';
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
    <div role="dialog" aria-modal="true" className="fixed z-20 inset-0 grid place-items-center p-5 bg-[rgba(3,6,9,0.7)] backdrop-blur-md max-md:items-end max-md:p-0">
      <div className="w-full max-w-[520px] max-h-[min(690px,calc(100dvh-40px))] flex flex-col border border-border-bright rounded-[13px] bg-[#101821] shadow-[0_24px_80px_rgba(0,0,0,0.5),0_0_0_1px_rgba(141,244,189,0.035)] overflow-hidden max-md:w-full max-md:max-h-[92dvh] max-md:border-b-0 max-md:rounded-t-[15px]">
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-border">
          <div>
            <div className="text-subtle font-mono text-[9px] font-medium tracking-[0.13em] leading-none uppercase">CLONE REPOSITORY</div>
            <h2 className="m-0 mt-2 text-fg text-[19px] font-semibold tracking-[-0.04em]">Clone a git repository</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X size={16} /></Button>
        </div>
        <div className="flex flex-col gap-3 px-5 py-3">
          <label className="flex flex-col gap-2">
            <span className="text-subtle font-mono text-[10px] tracking-[0.13em] uppercase">URL</span>
            <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/owner/repo.git" autoFocus />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-subtle font-mono text-[10px] tracking-[0.13em] uppercase">Destination path</span>
            <Input value={path} onChange={(event) => setPath(event.target.value)} placeholder={suggestion ? `${suggestion.parent}/<name>` : '/path/to/destination'} />
          </label>
          {suggestion && (
            <p className="m-0 text-subtle text-[11px]">
              Default: <code className="px-1 py-px border border-border rounded text-fg font-mono text-[10px]">{suggestion.parent}</code> ({sourceLabel(suggestion.source)})
            </p>
          )}
          {error && <p className="m-0 text-danger text-[11px]">{error}</p>}
        </div>
        <div className="flex items-center justify-between gap-2.5 px-5 pt-3.5 pb-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="default" onClick={() => void submit()} disabled={busy || !url.trim()}>
            {busy ? 'Cloning…' : 'Clone'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'env': return 'BASE_CLONE_PATH';
    case 'history': return 'previous clone parent';
    case 'home': return 'home directory';
    default: return source;
  }
}
