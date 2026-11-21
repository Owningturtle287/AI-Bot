import { pauseQueue, wakeQueue } from './queue-runner.mjs?v=5';

const cacheName = 'neural-workshop-v5';
const shell = [
  './', './index.html', './style.css', './theme.js', './app.mjs', './model.mjs', './storage.mjs',
  './trainer.mjs', './zip.mjs', './model.mjs?v=5', './queue-runner.mjs?v=5',
  './queue-worker.mjs', './generation-worker.mjs', './manifest.webmanifest',
  './assets/icon-192.png', './assets/icon-512.png', './assets/icons.png', './assets/algebra-starter.zip'
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

async function broadcast(message) {
  for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
    if (client.url.startsWith(self.registration.scope)) client.postMessage(message);
  }
}

self.addEventListener('message', event => {
  if (event.data === 'queue:pause') pauseQueue();
  if (event.data === 'queue:wake') event.waitUntil(wakeQueue(broadcast));
});

self.addEventListener('sync', event => {
  if (event.tag === 'training-queue') event.waitUntil(wakeQueue(broadcast));
});
