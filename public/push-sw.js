/* global self */
// Reminder notifications (loaded into Kopor's service worker). The server sends { title, body, url, tag }.
self.addEventListener('push', (event) => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch { m = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(m.title || 'Kopor', {
    body: m.body || '', tag: m.tag || 'kopor', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: m.url || './' },
  }));
});

// Tapping a notification opens (or focuses) Kopor on the right page.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) if ('focus' in w) { w.navigate(url); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
