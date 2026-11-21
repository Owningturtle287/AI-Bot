const cacheName = 'neural-workshop-v1';
const shell = [
  './', './index.html', './style.css', './app.mjs', './model.mjs', './storage.mjs',
  './trainer.mjs', './zip.mjs', './manifest.webmanifest', './assets/icon-192.png',
  './assets/icon-512.png', './assets/icons.png', './assets/algebra-starter.zip'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(shell)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('neural-workshop-') && key !== cacheName)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

const core = new Set(shell.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !core.has(event.request.url)) return;
  event.respondWith(fetch(event.request).then(async response => {
    if (response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(event.request, response.clone());
    }
    return response;
  }).catch(async () => (await caches.match(event.request)) || Response.error()));
});
