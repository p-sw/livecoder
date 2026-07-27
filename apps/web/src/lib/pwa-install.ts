// ponytail: capture beforeinstallprompt so the landing button can call prompt().

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const cb of listeners) cb();
}

function standalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  );
}

export function canPromptInstall(): boolean {
  return deferred != null && !standalone();
}

export function subscribeInstallAvailability(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export async function promptInstall(): Promise<void> {
  if (!deferred || standalone()) return;
  const event = deferred;
  deferred = null;
  notify();
  try {
    await event.prompt();
    await event.userChoice;
  } catch {
    // Event is spent; wait for a later beforeinstallprompt.
  }
}

/** Call once at boot. */
export function initPwaInstall(): void {
  if (typeof window === 'undefined' || standalone()) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}
