// ponytail: settings panel with Tailwind utility classes. The previous
// version used .settings-row / .settings-row-label / etc. that lived in
// styles.css. Now they're inline utilities so adding new rows doesn't
// require touching the global stylesheet.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Check, FolderOpen, RefreshCw, RotateCcw, Save } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { agentStatus, settings, type AdapterInfo, type AgentStatus, type Settings } from '../api';
import { useWorkspaceStore } from '../workspace-context';
import { routeWithWorkspace } from '../router';

export function SettingsPanel() {
  const navigate = useNavigate();
  const { workspace } = useWorkspaceStore();
  const [current, setCurrent] = useState<Settings>({ cloneBasePath: null, defaultAdapterId: null });
  const [defaults] = useState<Settings>({ cloneBasePath: null, defaultAdapterId: null });
  const [path, setPath] = useState<string>('');
  const [clonePath, setClonePath] = useState('');
  const [adapter, setAdapter] = useState<string>('');
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [statusSource, setStatusSource] = useState<AgentStatus['defaultAdapterSource']>('builtin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [s, a] = await Promise.all([settings.get(), agentStatus()]);
      setCurrent(s.settings);
      setPath(s.path);
      setClonePath(s.settings.cloneBasePath ?? '');
      setAdapter(s.settings.defaultAdapterId ?? a.defaultAdapter);
      setAdapters(a.adapters);
      setStatusSource(a.defaultAdapterSource);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSave = useCallback(async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next: Settings = {
        cloneBasePath: clonePath.trim() ? clonePath.trim() : null,
        defaultAdapterId: adapter.trim() ? adapter.trim() : null,
      };
      const result = await settings.update(next);
      setCurrent(result.settings);
      setClonePath(result.settings.cloneBasePath ?? '');
      setAdapter(result.settings.defaultAdapterId ?? '');
      setSaved(true);
      // ponytail: re-fetch the status so the "current default" label
      // updates without a page refresh.
      const status = await agentStatus();
      setStatusSource(status.defaultAdapterSource);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [clonePath, adapter]);

  const onReset = useCallback(async (key: keyof Settings) => {
    setBusy(true);
    setError(null);
    try {
      const result = await settings.update({ ...current, [key]: null });
      setCurrent(result.settings);
      if (key === 'cloneBasePath') setClonePath('');
      if (key === 'defaultAdapterId') setAdapter('');
      setSaved(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [current]);

  return (
    <aside className="bg-surface-alt flex flex-col h-full">
      <div className="h-16 shrink-0 flex items-center justify-between pl-4 pr-3.5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <Button variant="ghost" size="icon" onClick={() => navigate({ to: routeWithWorkspace('/files', workspace?.path) })} aria-label="Back to files" className="md:hidden">
            <ArrowLeft size={17} />
          </Button>
          <div>
            <div className="text-subtle font-mono text-[9px] font-medium tracking-[0.13em] leading-none uppercase">SETTINGS</div>
            <h2 className="m-0 mt-1.5 text-fg text-sm font-semibold tracking-[-0.02em]">Workspace settings</h2>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => void refresh()} disabled={busy} aria-label="Reload">
          <RefreshCw size={15} className={busy ? 'spin' : ''} />
        </Button>
      </div>

      <ScrollArea className="ui-scroll-area">
        <section className="px-[18px] py-4 pb-6">
          <h3 className="m-0 mb-1 text-fg text-[13px] font-semibold tracking-[-0.01em]">Source control</h3>
          <p className="m-0 mb-4 text-muted text-[11px] leading-[1.5]">
            Stored at <code className="px-1 py-px border border-border rounded bg-[rgba(255,255,255,0.03)] text-fg font-mono text-[10px] break-all">{path || '~/.config/livecoder/settings.json'}</code>.
            Overrides env vars but does not write to <code className="px-1 py-px border border-border rounded bg-[rgba(255,255,255,0.03)] text-fg font-mono text-[10px]">.env</code>.
          </p>

          <div className="flex flex-col gap-3 py-3.5 border-t border-[rgba(32,45,58,0.7)]">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 text-fg text-xs font-semibold">
                <FolderOpen size={14} className="text-accent" />
                <span>Clone base path</span>
              </div>
              <p className="m-0 mt-1 mb-1 text-muted text-[11px] leading-[1.5]">
                Where new repositories land when you clone. Leave blank to use the env default or the home directory.
              </p>
              <p className="m-0 text-subtle font-mono text-[10px]">
                Current: <strong className="text-fg font-medium">{current.cloneBasePath ?? <em className="not-italic text-muted">unset</em>}</strong>
                {current.cloneBasePath === null && defaults.cloneBasePath !== null && (
                  <span className="text-subtle"> ({'env / home'}: {defaults.cloneBasePath})</span>
                )}
              </p>
            </div>
            <div className="w-full">
              <div className="flex gap-1.5 items-center">
                <Input value={clonePath} onChange={(event) => setClonePath(event.target.value)} placeholder="/path/to/clones" />
                {current.cloneBasePath !== null && (
                  <Button variant="ghost" size="icon" onClick={() => void onReset('cloneBasePath')} disabled={busy} aria-label="Reset to default" title="Reset to default">
                    <RotateCcw size={14} />
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 py-3.5 border-t border-[rgba(32,45,58,0.7)]">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 text-fg text-xs font-semibold">
                <Save size={14} className="text-accent" />
                <span>Default adapter</span>
              </div>
              <p className="m-0 mt-1 mb-1 text-muted text-[11px] leading-[1.5]">
                Which ACP adapter the agent uses. Change takes effect on the next chat session.
              </p>
              <p className="m-0 text-subtle font-mono text-[10px]">
                Current: <strong className="text-fg font-medium">{current.defaultAdapterId ?? <em className="not-italic text-muted">unset</em>}</strong>
                {current.defaultAdapterId === null && (
                  <span className="text-subtle"> ({statusSource === 'builtin' ? 'built-in pi' : statusSource}: {defaults.defaultAdapterId ?? 'pi'})</span>
                )}
              </p>
            </div>
            <div className="w-full">
              <div className="flex gap-1.5 items-center">
                <select
                  value={adapter}
                  onChange={(event) => setAdapter(event.target.value)}
                  className="w-full h-9 px-3 border border-border rounded-md bg-bg text-fg text-[13px] outline-none focus:border-accent/55 focus:shadow-[0_0_0_3px_rgba(141,244,189,0.08)]"
                >
                  <option value="">Use default</option>
                  {adapters.map((a) => (
                    <option key={a.id} value={a.id} disabled={!a.installed}>
                      {a.label}{!a.installed ? ' (not installed)' : ''}
                    </option>
                  ))}
                </select>
                {current.defaultAdapterId !== null && (
                  <Button variant="ghost" size="icon" onClick={() => void onReset('defaultAdapterId')} disabled={busy} aria-label="Reset to default" title="Reset to default">
                    <RotateCcw size={14} />
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 pt-4 border-t border-[rgba(32,45,58,0.7)]">
            <Button variant="default" onClick={() => void onSave()} disabled={busy}>
              <Save size={14} /> {busy ? 'Saving…' : 'Save changes'}
            </Button>
            {saved && <span className="inline-flex items-center gap-1 text-accent text-[11px]"><Check size={13} /> Saved</span>}
          </div>
          {error && (
            <div className="mt-2.5 px-2.5 py-2 border border-danger/25 rounded-md text-danger bg-danger/10 text-[11px]">{error}</div>
          )}
        </section>
      </ScrollArea>
    </aside>
  );
}
