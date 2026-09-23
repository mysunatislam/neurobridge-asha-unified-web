// Retire the original Flutter cache-first worker now that this URL is a module hub.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    await self.registration.unregister();
  })());
});
self.addEventListener('fetch', (event) => event.respondWith(fetch(event.request)));
