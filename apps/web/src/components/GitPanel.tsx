import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpToLine, GitBranch, GitCommit, GitFork, GitMerge, Plus, RefreshCw, Tag, Trash2, X } from 'lucide-react';
import { git, type GitBranchInfo, type GitCommitInfo, type GitDiffFile, type GitRemoteInfo, type GitStatus, type GitTagInfo, type GitCloneResult } from '../api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { cn } from '../lib/utils';

interface GitPanelProps {
  workspace: string;
  onCloned?: (path: string) => void;
  onOpenChange?: () => void;
}

export function GitPanel({ workspace, onCloned, onOpenChange }: GitPanelProps) {
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
    setLoading(true);
    setError(null);
    try {
      const [next, nextLog, nextBranches, nextTags, nextRemotes] = await Promise.all([
        git.status(workspace),
        git.log(workspace, 30),
        git.branches(workspace),
        git.tags(workspace),
        git.remotes(workspace),
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
  }, [workspace, selectedFile]);

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
    void runOp('commit', () => git.commit(workspace, commitMessage.trim(), true).then(() => setCommitMessage('')));
  };

  const onPush = () => runOp('push', () => git.push(workspace, { setUpstream: !status?.upstream }));
  const onPull = () => runOp('pull', () => git.pull(workspace));
  const onFetch = () => runOp('fetch', () => git.fetch(workspace, { prune: true }));

  const onCheckout = (branch: string) => runOp(`checkout ${branch}`, () => git.checkout(workspace, branch));
  const onCreateBranch = () => {
    if (!newBranch.trim()) return;
    const name = newBranch.trim();
    void runOp(`create ${name}`, () => git.checkout(workspace, name, true).then(() => setNewBranch('')));
  };
  const onDeleteBranch = (branch: string) => runOp(`delete ${branch}`, () => git.deleteBranch(workspace, branch, true));

  const onCreateTag = () => {
    if (!newTagName.trim()) return;
    const name = newTagName.trim();
    const message = newTagMessage.trim() || undefined;
    void runOp(`tag ${name}`, () => git.createTag(workspace, name, message).then(() => {
      setNewTagName('');
      setNewTagMessage('');
    }));
  };
  const onDeleteTag = (name: string) => runOp(`delete tag ${name}`, () => git.deleteTag(workspace, name));

  const onAddRemote = () => {
    if (!newRemoteName.trim() || !newRemoteUrl.trim()) return;
    const name = newRemoteName.trim();
    const url = newRemoteUrl.trim();
    void runOp(`add remote ${name}`, () => git.addRemote(workspace, name, url).then(() => {
      setNewRemoteName('');
      setNewRemoteUrl('');
    }));
  };
  const onRemoveRemote = (name: string) => runOp(`remove remote ${name}`, () => git.removeRemote(workspace, name));

  return (
    <aside className="panel git-panel">
      <div className="git-header">
        <div className="git-title">
          <div className="git-avatar"><GitBranch size={17} /></div>
          <div>
            <div className="panel-kicker">SOURCE CONTROL</div>
            <h2>{status?.branch ?? 'Git'}</h2>
          </div>
        </div>
        <div className="git-actions">
          <Button variant="ghost" size="icon" onClick={() => void refresh()} disabled={loading} aria-label="Refresh"><RefreshCw size={15} className={loading ? 'spin' : ''} /></Button>
        </div>
      </div>

      {error && <div className="git-error"><X size={13} /><span>{error}</span></div>}

      <div className="git-toolbar">
        <Button variant="secondary" size="sm" onClick={onPush} disabled={busy !== null}><ArrowUpToLine size={14} /> Push</Button>
        <Button variant="secondary" size="sm" onClick={onPull} disabled={busy !== null}><ArrowDownToLine size={14} /> Pull</Button>
        <Button variant="ghost" size="sm" onClick={onFetch} disabled={busy !== null}><RefreshCw size={14} /> Fetch</Button>
        <Button variant="ghost" size="sm" onClick={() => setShowClone(true)}><GitFork size={14} /> Clone</Button>
        {onOpenChange && <Button variant="ghost" size="sm" onClick={onOpenChange}>Switch</Button>}
      </div>

      <div className="git-status-row">
        {status?.upstream && (
          <span className={cn('upstream', status.upstream.ahead > 0 && 'upstream-ahead', status.upstream.behind > 0 && 'upstream-behind')}>
            <GitMerge size={12} />
            {status.upstream.name}
            {status.upstream.ahead > 0 && <em>↑{status.upstream.ahead}</em>}
            {status.upstream.behind > 0 && <em>↓{status.upstream.behind}</em>}
          </span>
        )}
        {status && (
          <span className="git-counts">
            {status.shortstat.modified > 0 && <em className="count-modified">{status.shortstat.modified} modified</em>}
            {status.shortstat.added > 0 && <em className="count-added">{status.shortstat.added} added</em>}
            {status.shortstat.deleted > 0 && <em className="count-deleted">{status.shortstat.deleted} deleted</em>}
            {status.shortstat.untracked > 0 && <em className="count-untracked">{status.shortstat.untracked} untracked</em>}
            {status.clean && <em className="count-clean">clean</em>}
          </span>
        )}
      </div>

      <ScrollArea className="git-scroll">
        <section className="git-section">
          <h3><GitCommit size={13} /> Changes</h3>
          {status && status.files.length === 0 && <p className="git-empty">No changes</p>}
          <ul className="git-files">
            {(status?.files ?? []).map((file) => (
              <li key={`${file.status}:${file.path}`}>
                <button type="button" className={cn('git-file', selectedFile?.path === file.path && 'git-file-active')} onClick={() => setSelectedFile(file)}>
                  <span className={cn('git-file-status', `git-status-${file.status}`)}>{file.status[0]?.toUpperCase()}</span>
                  <span className="git-file-path" title={file.path}>{file.path}</span>
                  <span className="git-file-stats">
                    {file.additions > 0 && <em className="count-added">+{file.additions}</em>}
                    {file.deletions > 0 && <em className="count-deleted">-{file.deletions}</em>}
                  </span>
                </button>
                <div className="git-file-actions">
                  <button type="button" onClick={() => void runOp(`stage ${file.path}`, () => git.stage(workspace, [file.path]))} title="Stage"><Plus size={12} /></button>
                </div>
              </li>
            ))}
          </ul>
          {selectedFile && (
            <div className="git-diff">
              <div className="git-diff-header">
                <strong>{selectedFile.path}</strong>
                <span className="git-file-status">{selectedFile.status}</span>
              </div>
              <pre>{selectedFile.binary ? '(binary file)' : selectedFile.diff || '(no diff)'}</pre>
            </div>
          )}
        </section>

        <section className="git-section">
          <h3><GitCommit size={13} /> Commit</h3>
          <div className="git-commit-form">
            <Input value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} placeholder="Commit message" />
            <Button variant="default" size="sm" onClick={onCommit} disabled={busy !== null || !commitMessage.trim() || !status || status.clean}>
              <GitCommit size={14} /> Commit
            </Button>
          </div>
        </section>

        <section className="git-section">
          <h3><GitBranch size={13} /> Branches</h3>
          <ul className="git-list">
            {branches.filter((b) => !b.remote).map((branch) => (
              <li key={branch.name} className={cn('git-list-row', branch.current && 'git-list-row-active')}>
                <button type="button" onClick={() => onCheckout(branch.name)} disabled={branch.current || busy !== null}>
                  <span className="git-list-name">{branch.name}</span>
                  {branch.upstream && <span className="git-list-meta">{branch.upstream}</span>}
                </button>
                {!branch.current && <button type="button" className="git-list-action" onClick={() => onDeleteBranch(branch.name)} disabled={busy !== null} aria-label="Delete branch"><Trash2 size={12} /></button>}
              </li>
            ))}
          </ul>
          <div className="git-inline-form">
            <Input value={newBranch} onChange={(e) => setNewBranch(e.target.value)} placeholder="New branch" />
            <Button variant="ghost" size="sm" onClick={onCreateBranch} disabled={busy !== null || !newBranch.trim()}>Create</Button>
          </div>
        </section>

        <section className="git-section">
          <h3><Tag size={13} /> Tags</h3>
          {tags.length === 0 && <p className="git-empty">No tags</p>}
          <ul className="git-list">
            {tags.map((tag) => (
              <li key={tag.name} className="git-list-row">
                <span className="git-list-name">{tag.name}</span>
                <span className="git-list-meta">{tag.hash.slice(0, 7)}</span>
                <button type="button" className="git-list-action" onClick={() => onDeleteTag(tag.name)} disabled={busy !== null} aria-label="Delete tag"><Trash2 size={12} /></button>
              </li>
            ))}
          </ul>
          <div className="git-inline-form">
            <Input value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="Tag name" />
            <Input value={newTagMessage} onChange={(e) => setNewTagMessage(e.target.value)} placeholder="Message (optional)" />
            <Button variant="ghost" size="sm" onClick={onCreateTag} disabled={busy !== null || !newTagName.trim()}>Create</Button>
          </div>
        </section>

        <section className="git-section">
          <h3><GitFork size={13} /> Remotes</h3>
          {remotes.length === 0 && <p className="git-empty">No remotes</p>}
          <ul className="git-list">
            {remotes.map((remote) => (
              <li key={remote.name} className="git-list-row">
                <span className="git-list-name">{remote.name}</span>
                <span className="git-list-meta">{remote.fetchUrl}</span>
                <button type="button" className="git-list-action" onClick={() => onRemoveRemote(remote.name)} disabled={busy !== null} aria-label="Remove remote"><Trash2 size={12} /></button>
              </li>
            ))}
          </ul>
          <div className="git-inline-form">
            <Input value={newRemoteName} onChange={(e) => setNewRemoteName(e.target.value)} placeholder="Name" />
            <Input value={newRemoteUrl} onChange={(e) => setNewRemoteUrl(e.target.value)} placeholder="https://example.com/repo.git" />
            <Button variant="ghost" size="sm" onClick={onAddRemote} disabled={busy !== null || !newRemoteName.trim() || !newRemoteUrl.trim()}>Add</Button>
          </div>
        </section>

        <section className="git-section">
          <h3><GitCommit size={13} /> History</h3>
          <ul className="git-log">
            {log.map((commit) => (
              <li key={commit.hash} className="git-log-row">
                <div className="git-log-header">
                  <span className="git-log-hash">{commit.short}</span>
                  <span className="git-log-subject">{commit.subject}</span>
                </div>
                <div className="git-log-meta">
                  <span>{commit.author}</span>
                  <span>{new Date(commit.date).toLocaleString()}</span>
                  {commit.refs && <span className="git-log-refs">{commit.refs}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </ScrollArea>

      {showClone && (
        <CloneDialog
          onClose={() => setShowClone(false)}
          onCloned={(result) => {
            setShowClone(false);
            onCloned?.(result.path);
          }}
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
    <div className="dialog-layer" role="dialog" aria-modal="true">
      <div className="folder-dialog">
        <div className="dialog-header">
          <div>
            <div className="dialog-kicker">CLONE REPOSITORY</div>
            <h2>Clone a git repository</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X size={16} /></Button>
        </div>
        <div className="dialog-body">
          <label className="dialog-field">
            <span>URL</span>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo.git" autoFocus />
          </label>
          <label className="dialog-field">
            <span>Destination path</span>
            <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder={suggestion ? `${suggestion.parent}/<name>` : '/path/to/destination'} />
          </label>
          {suggestion && (
            <p className="dialog-hint">
              Default: <code>{suggestion.parent}</code> ({sourceLabel(suggestion.source)})
            </p>
          )}
          {error && <p className="dialog-error">{error}</p>}
        </div>
        <div className="dialog-footer">
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
