// ponytail: tiny loading placeholder shown while a lazy route chunk
// streams in. Kept inside the panel slot so the topbar + mobile nav
// stay put — the user sees the chrome stay put and the body fill in.

import { Loader2 } from 'lucide-react';

export function RouteSpinner() {
  return (
    <div className="route-spinner" role="status" aria-live="polite">
      <Loader2 size={20} className="spin" />
      <span>Loading…</span>
    </div>
  );
}
