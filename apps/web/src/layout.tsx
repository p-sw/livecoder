// ponytail: shared chrome (topbar, mobile nav, workspace picker) lives here
// so each route file stays focused on its own panel. State is provided by
// <WorkspaceProvider> at the router root.

import { Outlet, Link, useRouterState } from '@tanstack/react-router';
import {
  Code2,
  FolderOpen,
  GitBranch,
  MessageSquare,
  PanelLeft,
  Settings as SettingsIcon,
} from 'lucide-react';
import type { WorkspaceResult } from './api';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { WorkspacePicker } from './components/WorkspacePicker';
import { WorkspaceProvider, useWorkspaceStore } from './workspace-context';

export function Layout() {
  return (
    <WorkspaceProvider>
      <AppShell />
    </WorkspaceProvider>
  );
}

function AppShell() {
  const { workspace, pickerOpen, setPickerOpen, openFolder } = useWorkspaceStore();

  return (
    <div className={`app-shell ${workspace ? 'workspace-shell' : 'empty-shell'}`}>
      <TopBar workspace={workspace} onOpen={() => setPickerOpen(true)} />
      <Outlet />
      <MobileNav />
      <WorkspacePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onOpen={openFolder}
        currentPath={workspace?.path}
      />
    </div>
  );
}

function TopBar({ workspace, onOpen }: { workspace: WorkspaceResult | null; onOpen: () => void }) {
  return (
    <header className="topbar">
      <div className="brand-lockup">
        <div className="brand-mark"><Code2 size={18} strokeWidth={2.5} /></div>
        <div className="brand-wordmark">livecoder</div>
        <span className="brand-divider" />
        <span className="brand-subtitle">workspace</span>
      </div>
      <div className="topbar-center">
        {workspace ? (
          <>
            <FolderOpen size={14} />
            <span className="topbar-workspace-name">{workspace.name}</span>
            <span className="topbar-path">{workspace.path}</span>
          </>
        ) : (
          <span className="empty-workspace-label">No workspace open</span>
        )}
      </div>
      <div className="topbar-actions">
        <Badge className="local-badge"><span className="status-dot" /> local workspace</Badge>
        {workspace ? (
          <Button variant="ghost" size="icon" className="topbar-icon-button" onClick={onOpen} aria-label="Change workspace" title="Change workspace">
            <FolderOpen size={17} />
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={onOpen}><FolderOpen size={15} /> Open folder</Button>
        )}
      </div>
    </header>
  );
}

// ponytail: mobile nav uses router <Link> rather than local state. The current
// route is tracked via useRouterState so the active tab lights up without
function MobileNav() {
  const { workspace } = useWorkspaceStore();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const tabs: { to: string; label: string; icon: typeof PanelLeft }[] = [
    { to: '/files', label: 'Files', icon: PanelLeft },
    { to: '/editor', label: 'Editor', icon: Code2 },
    { to: '/agent', label: 'Agent', icon: MessageSquare },
    { to: '/git', label: 'Git', icon: GitBranch },
    { to: '/settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <nav className="mobile-nav">
      {tabs.map((tab) => {
        // ponytail: Settings stays reachable even without an open workspace
        // so the user can fix a misconfigured path without first opening a
        // folder. The other tabs need a workspace to do anything useful.
        const locked = tab.to !== '/settings' && !workspace;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            disabled={locked}
            className={pathname === tab.to ? 'active' : undefined}
          >
            <tab.icon size={18} /><span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// ponytail: minimal empty state lives at the root route. The topbar's "Open
// folder" button triggers the picker; the empty state just makes the call
// feel intentional on a fresh load.
export function EmptyState() {
  const { setPickerOpen } = useWorkspaceStore();
  return (
    <main className="empty-content">
      <div className="empty-grid-glow" />
      <section className="empty-card">
        <div className="empty-icon-wrap">
          <div className="empty-icon-backdrop" />
          <FolderOpen size={34} strokeWidth={1.5} />
          <span className="empty-icon-pulse" />
        </div>
        <Badge className="eyebrow-badge"><span className="eyebrow-dot" /> ready when you are</Badge>
        <h1>Open a workspace<br /><em>and start building.</em></h1>
        <p className="empty-description">Work with the files on this machine, then ask Pi to inspect, explain, or edit them with you.</p>
        <Button size="lg" className="empty-open-button" onClick={() => setPickerOpen(true)}><FolderOpen size={18} /> Choose a folder <span className="button-arrow">↗</span></Button>
        <div className="empty-hint"><span className="status-dot" /><span>Local files, no account required</span></div>
      </section>
      <div className="empty-footer"><span>LIVECODER 01</span><span className="footer-line" /><span>DIRECT FILESYSTEM ACCESS</span></div>
    </main>
  );
}
