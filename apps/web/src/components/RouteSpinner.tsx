// ponytail: tiny loading placeholder shown while a lazy route chunk
// streams in. Kept inside the panel slot so the topbar + mobile nav
// stay put — the user sees the chrome stay put and the body fill in.

import { Loader2 } from 'lucide-react';

export function RouteSpinner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex-1 flex items-center justify-center gap-2.5 p-10 text-muted text-xs font-mono"
    >
      <Loader2 size={20} className="spin text-accent" />
      <span>Loading…</span>
    </div>
  );
}
