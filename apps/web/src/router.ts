// ponytail: every internal navigation appends ?workspace=<path> so a hard
// reload restores the workspace from the URL instead of dropping it. The
// helper takes a plain string path so callers don't need to know TanStack
// Router's typed-search surface; missing workspace returns the bare path.

export function routeWithWorkspace(path: string, workspace?: string | null): string {
  if (!workspace) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}workspace=${encodeURIComponent(workspace)}`;
}

export function readWorkspaceFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('workspace');
  return raw && raw.trim() ? raw : null;
}
