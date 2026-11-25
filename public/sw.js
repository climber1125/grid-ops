// Sparks Command field crew service worker: shows push notifications when the app is closed.
// No offline caching here on purpose — the app always loads fresh from the site.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', ev => ev.waitUntil(self.clients.claim()));

self.addEventListener('push', ev => {
  let d = {};
  try { d = ev.data ? ev.data.json() : {}; } catch { d = { body: ev.data ? ev.data.text() : '' }; }
  const title = d.title || 'Sparks Control';
  ev.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    tag: d.tag || 'sparks',
    renotify: true,
    requireInteraction: /CLEARED|TROUBLE|DISPATCH|STEP/i.test(title),
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    vibrate: [200, 100, 200, 100, 300],
    data: { url: d.url || '/field' },
  }));
});

self.addEventListener('notificationclick', ev => {
  ev.notification.close();
  const url = (ev.notification.data && ev.notification.data.url) || '/field';
  ev.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) if (new URL(c.url).pathname.startsWith('/field') || new URL(c.url).pathname.startsWith('/t/')) { await c.focus(); c.postMessage({ type: 'notification-click', url }); return; }
    await self.clients.openWindow(url);
  })());
});
