import { swCacheable, swStrategy } from './sw-routing';

/** Every cache this worker owns starts with this; nothing else on the origin is touched. */
export const CACHE_PREFIX = 'darkbeacon-';
export const OFFLINE_PAGE = '/offline.html';
/** Fetched when the worker installs, so the offline page works the first time the network goes. */
export const PRECACHE = [OFFLINE_PAGE, '/icons/mark.svg', '/favicon.svg'] as const;

/**
 * The service worker served at `/sw.js`. Its text changes with every build (the cache name holds
 * the build id), which is how browsers see an update. A new worker installs and then waits; it
 * takes over when every tab is gone, or at once when someone presses Reload on the update toast
 * (the page sends `SKIP_WAITING`).
 */
export function serviceWorkerScript(build: string): string {
  return `// Darkbeacon service worker (build ${JSON.stringify(build)}). See apps/web/src/pwa/.
'use strict';
const CACHE = ${JSON.stringify(`${CACHE_PREFIX}static-${build}`)};
const OFFLINE = ${JSON.stringify(OFFLINE_PAGE)};
const PRECACHE = ${JSON.stringify(PRECACHE)};
const strategy = (${String(swStrategy)});
const cacheable = (${String(swCacheable)});

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(${JSON.stringify(CACHE_PREFIX)}) && key !== CACHE) await caches.delete(key);
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const kind = strategy(event.request, self.location.origin);
  if (kind === 'static') event.respondWith(fromCache(event));
  else if (kind === 'navigate') event.respondWith(page(event));
  // Anything else is not intercepted: the browser fetches it as if there were no worker.
});

async function fromCache(event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const response = await fetch(event.request);
  if (cacheable(response)) event.waitUntil(cache.put(event.request, response.clone()).catch(() => {}));
  return response;
}

async function page(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch (error) {
    const offline = await caches.match(OFFLINE, { cacheName: CACHE });
    if (offline) return offline;
    throw error;
  }
}
`;
}

/**
 * Served instead while the PWA is switched off (`PWA=off`): it replaces any worker a browser
 * installed earlier, drops its caches and unregisters itself. Pages are never reloaded for it.
 */
export function killSwitchScript(): string {
  return `// Darkbeacon service worker: switched off on this instance (PWA=off). It removes itself.
'use strict';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(${JSON.stringify(CACHE_PREFIX)})) await caches.delete(key);
      await self.registration.unregister();
    })(),
  );
});
`;
}

/** Headers for `/sw.js`: never cached anywhere, allowed to control the whole origin. */
export const SW_HEADERS = {
  'content-type': 'text/javascript; charset=utf-8',
  'cache-control': 'no-cache, no-store, must-revalidate',
  'service-worker-allowed': '/',
} as const;
