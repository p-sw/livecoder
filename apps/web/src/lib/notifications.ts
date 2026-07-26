// ponytail: local Notification when tab is open-but-hidden; Web Push when
// the page is gone. Both share one permission prompt.

const VAPID_KEY = 'livecoder.vapidPublicKey';
const SUB_ENDPOINT = 'livecoder.pushEndpoint';

export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  return Notification.requestPermission();
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function fetchVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch('/api/push/vapid-public-key');
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (body && typeof body === 'object' && 'publicKey' in body && typeof body.publicKey === 'string') {
      return body.publicKey;
    }
    return null;
  } catch {
    return null;
  }
}

export async function ensurePushSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const permission = await ensureNotificationPermission();
  if (permission !== 'granted') return null;

  const reg = (await navigator.serviceWorker.ready.catch(() => null))
    ?? (await registerServiceWorker());
  if (!reg) return null;

  const publicKey = (await fetchVapidPublicKey()) ?? localStorage.getItem(VAPID_KEY);
  if (!publicKey) return null;
  localStorage.setItem(VAPID_KEY, publicKey);

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  // Always POST — localStorage can claim success after a server wipe/restart.
  try {
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    });
    localStorage.setItem(SUB_ENDPOINT, sub.endpoint);
  } catch {
    // subscription still valid locally; server will pick it up next try
  }
  return sub;
}

/** Notify only when the user left the app (hidden/unfocused). No-op if focused. */
export async function notifyAgentFinished(opts?: {
  title?: string;
  body?: string;
  error?: boolean;
  workspace?: string;
}): Promise<void> {
  if (typeof document === 'undefined') return;
  // visibilityState alone misses "other window focused, this tab still visible".
  const left = document.visibilityState === 'hidden' || !document.hasFocus();
  if (!left) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  const title = opts?.title ?? 'livecoder';
  const body = opts?.body ?? (opts?.error ? 'Agent hit an error' : 'Agent finished');
  // ponytail: same ?workspace= contract as in-app links / backend push
  const url = opts?.workspace
    ? `/agent?workspace=${encodeURIComponent(opts.workspace)}`
    : '/agent';
  const options: NotificationOptions = {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'agent-finished',
    data: { url },
  };

  try {
    const reg = await navigator.serviceWorker?.ready.catch(() => null);
    if (reg) {
      await reg.showNotification(title, options);
      return;
    }
  } catch {
    // fall through to page Notification
  }

  // eslint-disable-next-line no-new
  new Notification(title, options);
}
