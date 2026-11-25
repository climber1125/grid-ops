// Push notifications + install-to-home-screen for the crew phone.
//   Android Chrome: works in the browser tab or installed.
//   iPhone (iOS 16.4+): only after "Add to Home Screen" and opening it from that icon.
import { getBackend } from './backend';

export const VAPID_PUBLIC = 'BLzfcQJikvF__qe3qAkAoHDr1gHLx6XLYalGIHg04GLAprSrtSV7SHl6yKnrrUdUzh5CgRnHYXnSa3Dv9MLBuC8';

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export type PushState = 'on' | 'off' | 'denied' | 'needs-install' | 'unsupported' | 'local';
export async function pushState(): Promise<PushState> {
  if (getBackend().kind === 'local') return 'local';
  if (isIOS() && !isStandalone()) return 'needs-install';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

const b64ToBytes = (b64: string) => { const p = '='.repeat((4 - (b64.length % 4)) % 4); const s = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); };

/** Must be called from a tap. Registers the service worker, asks permission, saves the subscription to this crew. */
export async function enablePush(code: string, truck: string): Promise<PushState> {
  const st = await pushState();
  if (st === 'needs-install' || st === 'unsupported' || st === 'local') return st;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC) });
  await getBackend().savePush(code, truck, JSON.stringify(sub.toJSON()));
  return 'on';
}
/** Keep the server's copy fresh (subscriptions can rotate). Quiet, no prompts. */
export async function refreshPush(code: string, truck: string) {
  try {
    if ((await pushState()) !== 'on') return;
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await getBackend().savePush(code, truck, JSON.stringify(sub.toJSON()));
  } catch { /* offline */ }
}

/** Add the manifest + iOS home-screen tags (only on crew pages, so the console isn't installable as the crew app). */
export function installMeta() {
  const add = (tag: string, attrs: Record<string, string>) => { if (document.head.querySelector(`${tag}[${Object.keys(attrs)[0]}="${Object.values(attrs)[0]}"]`)) return; const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); document.head.appendChild(el); };
  add('link', { rel: 'manifest', href: '/field.webmanifest' });
  add('link', { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' });
  add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
  add('meta', { name: 'mobile-web-app-capable', content: 'yes' });
  add('meta', { name: 'apple-mobile-web-app-title', content: 'Sparks Field' });
  add('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' });
  add('meta', { name: 'theme-color', content: '#0d1117' });
}

// ── console side: send a notification to crews ──────────────
const sentKeys = new Set<string>();
export async function pushToCrews(code: string, trucks: string[], n: { title: string; body: string; tag?: string; url?: string }, dedupeKey?: string) {
  const be = getBackend();
  if (be.kind === 'local' || !trucks.length) return;
  if (dedupeKey) { if (sentKeys.has(dedupeKey)) return; sentKeys.add(dedupeKey); }
  try {
    const tok = await be.idToken(); if (!tok) return;
    await fetch('/.netlify/functions/push', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify({ code, trucks, ...n }) });
  } catch (err) { console.warn('push failed', err); }
}
