// ponytail: the settings panel reads from /api/settings on mount, lets the
// user override the clone base path and default agent, and PUTs back to
// the same endpoint. Each row shows the env fallback so the user knows
// what their override is replacing.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Check, FolderOpen, RefreshCw, RotateCcw, Save } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { agentStatus, settings, type AdapterInfo, type AgentStatus, type Settings } from '../api';

export function SettingsPanel() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState<Settings>({ cloneBasePath: null, defaultAdapterId: null });
  const [defaults, setDefaults] = useState<Settings>({ cloneBasePath: null, defaultAdapterId: null });
  const [path, setPath] = useState<string>('');
  const [clonePath, setClonePath] = useState('');
  const [adapter, setAdapter] = useState<string>('');
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [statusSource, setStatusSource] = useState<AgentStatus['defaultAdapterSource']>('builtin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([settings.get(), agentStatus()])
      .then(([s, a]) => {
        setCurrent(s.settings);
        setDefaults(s.defaults);
        setPath(s.path);
        setClonePath(s.settings.cloneBasePath ?? '');
        setAdapter(s.settings.defaultAdapterId ?? a.defaultAdapter);
        setAdapters(a.adapters);
        setStatusSource(a.defaultAdapterSource);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
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
      // ponytail: re-fetch the status so the "current default" label updates
      // without a page refresh.
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
    <aside className="panel settings-panel">
      <div className="settings-header">
        <div className="settings-title">
          <Button variant="ghost" size="icon" className="mobile-back" onClick={() => navigate({ to: '/files' })} aria-label="Back to files"><ArrowLeft size={17} /></Button>
          <div>
            <div className="panel-kicker">SETTINGS</div>
            <h2>Workspace settings</h2>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => void Promise.all([settings.get(), agentStatus()]).then(([s, a]) => { setCurrent(s.settings); setDefaults(s.defaults); setPath(s.path); setClonePath(s.settings.cloneBasePath ?? ''); setAdapter(s.settings.defaultAdapterId ?? a.defaultAdapter); setAdapters(a.adapters); setStatusSource(a.defaultAdapterSource); }).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))} disabled={busy} aria-label="Reload"><RefreshCw size={15} className={busy ? 'spin' : ''} /></Button>
      </div>

      <ScrollArea className="settings-scroll">
        <section className="settings-section">
          <h3>Source control</h3>
          <p className="settings-hint">Stored at <code>{path || '~/.config/livecoder/settings.json'}</code>. Overrides env vars but does not write to <code>.env</code>.</p>

          <SettingsRow
            icon={<FolderOpen size={14} />}
            label="Clone base path"
            description="Where new repositories land when you clone. Leave blank to use the env default or the home directory."
            currentValue={current.cloneBasePath}
            fallbackValue={defaults.cloneBasePath ?? null}
            fallbackLabel="env / home"
          >
            <div className="settings-row-input">
              <Input value={clonePath} onChange={(event) => setClonePath(event.target.value)} placeholder="/path/to/clones" />
              {current.cloneBasePath !== null && (
                <Button variant="ghost" size="icon" onClick={() => void onReset('cloneBasePath')} disabled={busy} aria-label="Reset to default" title="Reset to default"><RotateCcw size={14} /></Button>
              )}
            </div>
          </SettingsRow>

          <SettingsRow
            icon={<Save size={14} />}
            label="Default adapter"
            description="Which agent the chat opens with. The picker in the agent panel overrides this per session."
            currentValue={current.defaultAdapterId}
            fallbackValue={defaults.defaultAdapterId ?? 'pi'}
            fallbackLabel={statusSource === 'builtin' ? 'built-in pi' : statusSource}
          >
            <div className="settings-row-input">
              <select
                className="settings-select"
                value={adapter}
                onChange={(event) => setAdapter(event.target.value)}
              >
                <option value="">Use default</option>
                {adapters.map((a) => (
                  <option key={a.id} value={a.id} disabled={!a.installed}>
                    {a.label}{!a.installed ? ' (not installed)' : ''}
                  </option>
                ))}
              </select>
              {current.defaultAdapterId !== null && (
                <Button variant="ghost" size="icon" onClick={() => void onReset('defaultAdapterId')} disabled={busy} aria-label="Reset to default" title="Reset to default"><RotateCcw size={14} /></Button>
              )}
            </div>
          </SettingsRow>

          <div className="settings-actions">
            <Button variant="default" onClick={() => void onSave()} disabled={busy}>
              <Save size={14} /> {busy ? 'Saving…' : 'Save changes'}
            </Button>
            {saved && <span className="settings-saved"><Check size={13} /> Saved</span>}
          </div>
          {error && <div className="settings-error">{error}</div>}
        </section>
      </ScrollArea>
    </aside>
  );
}

interface SettingsRowProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  currentValue: string | null;
  fallbackValue: string | null;
  fallbackLabel: string;
  children: React.ReactNode;
}

function SettingsRow({ icon, label, description, currentValue, fallbackValue, fallbackLabel, children }: SettingsRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row-meta">
        <div className="settings-row-label">{icon}<span>{label}</span></div>
        <p className="settings-row-description">{description}</p>
        <p className="settings-row-source">
          Current: <strong>{currentValue ?? <em>unset</em>}</strong>
          {currentValue === null && fallbackValue !== null && <span className="settings-row-fallback"> ({fallbackLabel}: {fallbackValue})</span>}
        </p>
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}
