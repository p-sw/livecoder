// ponytail: shared chrome (topbar, mobile nav, empty state) in Tailwind
// utility classes. The router <Outlet/> swaps the body; the chrome
// stays put. The app shell sets `bg-empty-bg` (empty-shell) or
// `bg-bg` (workspace-shell) so the empty-state background gradient
// stays under the fold.

import { lazy, Suspense } from 'react';
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
import { RouteSpinner } from './components/RouteSpinner';
import { WorkspaceProvider, useWorkspaceStore } from './workspace-context';

const WorkspacePicker = lazy(() =>
  import('./components/WorkspacePicker').then((m) => ({ default: m.WorkspacePicker })),
);

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
    <div
      className={
        'w-full h-[100dvh] min-h-[480px] flex flex-col overflow-hidden ' +
        (workspace ? 'bg-bg' : 'bg-empty-bg')
      }
    >
      <TopBar workspace={workspace} onOpen={() => setPickerOpen(true)} />
      <Outlet />
      <MobileNav />
      <Suspense fallback={null}>
        <WorkspacePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onOpen={openFolder}
          currentPath={workspace?.path}
        />
      </Suspense>
    </div>
  );
}

function TopBar({ workspace, onOpen }: { workspace: WorkspaceResult | null; onOpen: () => void }) {
  return (
    <header className="relative z-[3] h-[62px] shrink-0 grid grid-cols-[1fr_auto_1fr] items-center px-[18px] border-b border-border bg-topbar">
      <div className="flex items-center gap-[9px] min-w-0">
        <div className="w-[29px] h-[29px] grid place-items-center border border-accent/40 rounded-lg text-accent bg-accent-dim shadow-[inset_0_0_18px_rgba(141,244,187,0.06)]">
          <Code2 size={18} strokeWidth={2.5} />
        </div>
        <div className="text-[#f2f8fb] text-base font-bold tracking-[-0.04em]">livecoder</div>
        <span className="hidden md:inline w-px h-[17px] mx-[3px] ml-1.5 bg-border-bright" />
        <span className="hidden md:inline text-subtle font-mono text-[10px] tracking-[0.08em] uppercase">workspace</span>
      </div>
      <div className="hidden md:flex items-center gap-[7px] max-w-[45vw] text-muted text-xs">
        {workspace ? (
          <>
            <FolderOpen size={14} className="text-accent shrink-0" />
            <span className="text-fg font-semibold">{workspace.name}</span>
            <span className="max-w-[280px] overflow-hidden text-subtle font-mono text-[10px] text-ellipsis whitespace-nowrap">{workspace.path}</span>
          </>
        ) : (
          <span className="text-subtle font-mono text-[11px] tracking-[0.03em]">No workspace open</span>
        )}
      </div>
      <div className="flex items-center justify-end gap-[7px]">
        <Badge className="hidden md:inline-flex border-accent/17 text-accent bg-accent-dim normal-case tracking-[0.01em] text-[10px]">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-strong shadow-[0_0_0_3px_rgba(82,223,160,0.1)]" /> local workspace
        </Badge>
        {workspace ? (
          <Button variant="ghost" size="icon" onClick={onOpen} aria-label="Change workspace" title="Change workspace">
            <FolderOpen size={17} />
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={onOpen}>
            <FolderOpen size={15} /> Open folder
          </Button>
        )}
      </div>
    </header>
  );
}

// ponytail: mobile nav uses router <Link> rather than local state. The
// current route is tracked via useRouterState so the active tab lights
// up without duplicating route state in React.
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
    <nav className="md:hidden h-[59px] shrink-0 flex items-stretch justify-around border-t border-border bg-mobile-nav pb-[env(safe-area-inset-bottom)]">
      {tabs.map((tab) => {
        // ponytail: Settings stays reachable even without an open workspace
        // so the user can fix a misconfigured path without first opening
        // a folder. The other tabs need a workspace to do anything useful.
        const locked = tab.to !== '/settings' && !workspace;
        const active = pathname === tab.to;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-disabled={locked}
            className={
              'relative min-w-[74px] flex flex-col items-center justify-center gap-1 bg-transparent text-[9px] no-underline ' +
              (locked ? 'opacity-40 pointer-events-none' : '') +
              (active ? ' text-accent' : ' text-subtle')
            }
          >
            <tab.icon size={18} />
            <span>{tab.label}</span>
            {active && <span className="absolute top-[-1px] left-[30%] right-[30%] h-0.5 bg-accent shadow-[0_0_10px_var(--color-accent)]" />}
          </Link>
        );
      })}
    </nav>
  );
}

// ponytail: minimal empty state lives at the root route. The topbar's
// "Open folder" button triggers the picker; the empty state just
// makes the call feel intentional on a fresh load.
export function EmptyState() {
  const { setPickerOpen } = useWorkspaceStore();
  return (
    <main className="relative isolate flex-1 grid place-items-center overflow-hidden py-[42px] px-5">
      <div
        aria-hidden
        className="absolute inset-0 z-[-2] opacity-30 [background-image:linear-gradient(rgba(139,170,178,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(139,170,178,0.055)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:linear-gradient(to_bottom,transparent,#000_22%,#000_75%,transparent)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 z-[-1] pointer-events-none [background:radial-gradient(circle_at_50%_41%,rgba(104,235,179,0.1),transparent_23%),radial-gradient(circle_at_16%_22%,rgba(117,166,255,0.055),transparent_18%)]"
      />
      <div
        aria-hidden
        className="absolute top-[17%] left-1/2 w-px h-[60%] bg-gradient-to-b from-transparent via-accent/20 to-transparent opacity-45"
      />
      <section className="relative w-full max-w-[460px] flex flex-col items-center text-center px-5">
        <div className="relative w-[82px] h-[82px] grid place-items-center mb-6 border border-accent/30 rounded-2xl text-accent bg-gradient-to-br from-accent/[0.13] to-accent/[0.025] shadow-[0_0_0_10px_rgba(141,244,189,0.022),0_0_55px_rgba(86,223,160,0.13)]">
          <div className="absolute inset-[9px] border border-dashed border-accent/22 rounded-xl" />
          <FolderOpen size={34} strokeWidth={1.5} />
          <span className="absolute right-[11px] top-[11px] w-2 h-2 rounded-full bg-accent shadow-[0_0_0_5px_rgba(141,244,189,0.12),0_0_14px_var(--color-accent)]" />
        </div>
        <Badge className="mb-3.5 border-accent/19 text-accent bg-accent-dim text-[9px]">
          <span className="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" /> ready when you are
        </Badge>
        <h1 className="m-0 text-[clamp(32px,5vw,48px)] text-[#eef7f5] font-semibold leading-[1.05] tracking-[-0.055em]">
          Open a workspace<br />
          <em className="text-accent not-italic">and start building.</em>
        </h1>
        <p className="max-w-[365px] mt-[19px] mb-[26px] text-muted text-sm leading-[1.65]">
          Work with the files on this machine, then ask Pi to inspect, explain, or edit them with you.
        </p>
        <Button size="lg" className="min-w-[190px]" onClick={() => setPickerOpen(true)}>
          <FolderOpen size={18} /> Choose a folder <span className="ml-1 text-lg leading-none">↗</span>
        </Button>
        <div className="flex items-center gap-2 mt-4 text-subtle text-[11px]">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          <span>Local files, no account required</span>
        </div>
      </section>
      <div className="absolute bottom-[22px] left-0 right-0 flex items-center justify-center gap-3 text-[#3c4a54] font-mono text-[9px] tracking-[0.14em]">
        <span>LIVECODER 01</span>
        <span className="w-11 h-px bg-[#293640]" />
        <span>DIRECT FILESYSTEM ACCESS</span>
      </div>
    </main>
  );
}
