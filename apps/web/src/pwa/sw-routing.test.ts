import { describe, expect, it, vi } from 'vitest';
import { swCacheable, swStrategy, type SwRequestLike } from './sw-routing';
import { killSwitchScript, OFFLINE_PAGE, PRECACHE, serviceWorkerScript } from './sw-script';

const ORIGIN = 'https://beacon.example';

function request(
  path: string,
  init: Partial<Omit<SwRequestLike, 'headers'>> & { headers?: Record<string, string> } = {},
) {
  const headers = new Headers(init.headers ?? {});
  return {
    url: path.startsWith('http') ? path : `${ORIGIN}${path}`,
    method: init.method ?? 'GET',
    mode: init.mode ?? 'no-cors',
    headers,
  };
}

const page = (path: string) => request(path, { mode: 'navigate' });

describe('swStrategy', () => {
  it('never touches the API, the socket, sign-in, MCP, OAuth, support or metrics', () => {
    for (const path of [
      '/api',
      '/api/maps',
      '/api/auth/eve/login',
      '/api/auth/eve/callback?code=x&state=y',
      '/api/auth/discord/callback',
      '/api/v1/maps/1/snapshot',
      '/ws',
      '/ws?token=x',
      '/mcp',
      '/auth/callback',
      '/oauth/authorize?client_id=x',
      '/.well-known/openid-configuration',
      '/support',
      '/support?kind=ticket',
      '/metrics',
      '/healthz',
      '/sw.js',
      '/manifest.webmanifest',
    ]) {
      expect(swStrategy(request(path), ORIGIN), path).toBe('network');
      // Not even as a page load: an SSO redirect lands on these, and must reach the server as is.
      expect(swStrategy(page(path), ORIGIN), `navigate ${path}`).toBe('network');
    }
  });

  it('loads pages from the network, with the offline page as the only fallback', () => {
    for (const path of ['/', '/m/home', '/jump', '/login?next=%2Fm%2Fhome', '/p/abc', '/account'])
      expect(swStrategy(page(path), ORIGIN), path).toBe('navigate');
  });

  it('caches content-hashed build output, fonts and icons', () => {
    for (const path of [
      '/_next/static/chunks/0a1b2c.js',
      '/_next/static/css/9f8e.css',
      '/_next/static/media/inter-latin-wght-normal.0f1e2d.woff2',
      '/icons/icon-192.png',
      '/favicon.svg',
      OFFLINE_PAGE,
    ])
      expect(swStrategy(request(path), ORIGIN), path).toBe('static');
  });

  it('leaves everything credentials-dependent to the network', () => {
    // Client navigations and prefetches (RSC payloads) carry the session's data.
    expect(swStrategy(request('/m/home', { headers: { rsc: '1' } }), ORIGIN)).toBe('network');
    expect(swStrategy(request('/m/home?_rsc=1x2y'), ORIGIN)).toBe('network');
    expect(swStrategy(request('/jump', { headers: { 'next-router-prefetch': '1' } }), ORIGIN)).toBe(
      'network',
    );
    expect(
      swStrategy(request('/_next/static/chunks/a.js', { headers: { authorization: 'Bearer x' } }), ORIGIN),
    ).toBe('network');
    // Anything else on the origin (images through the optimizer, plugin assets, robots.txt).
    for (const path of ['/_next/image?url=x', '/robots.txt', '/plugins/x/asset.js'])
      expect(swStrategy(request(path), ORIGIN), path).toBe('network');
  });

  it('only handles GET requests on its own origin', () => {
    expect(swStrategy(request('/_next/static/a.js', { method: 'POST' }), ORIGIN)).toBe('network');
    expect(swStrategy({ ...page('/'), method: 'POST' }, ORIGIN)).toBe('network');
    expect(swStrategy(request('https://images.evetech.net/characters/1/portrait'), ORIGIN)).toBe('network');
    expect(swStrategy(page('https://login.eveonline.com/v2/oauth/authorize'), ORIGIN)).toBe('network');
    expect(swStrategy(request('not a url'), ORIGIN)).toBe('network');
  });
});

describe('swCacheable', () => {
  const response = (status: number, headers: Record<string, string> = {}, type = 'basic') => ({
    status,
    type,
    headers: new Headers(headers),
  });

  it('keeps plain, public, same-origin answers', () => {
    expect(swCacheable(response(200, { 'cache-control': 'public, max-age=31536000, immutable' }))).toBe(true);
    expect(swCacheable(response(200, { vary: 'Accept-Encoding' }))).toBe(true);
  });

  it('refuses errors, redirects, opaque answers and anything private', () => {
    expect(swCacheable(response(404))).toBe(false);
    expect(swCacheable(response(206))).toBe(false);
    expect(swCacheable(response(0, {}, 'opaque'))).toBe(false);
    expect(swCacheable(response(200, {}, 'opaqueredirect'))).toBe(false);
    expect(swCacheable(response(200, { 'cache-control': 'no-store' }))).toBe(false);
    expect(swCacheable(response(200, { 'cache-control': 'private, max-age=60' }))).toBe(false);
    expect(swCacheable(response(200, { vary: 'Cookie' }))).toBe(false);
    expect(swCacheable(response(200, { vary: '*' }))).toBe(false);
  });
});

// ---- The served script, run against stand-ins for the worker's globals.

interface FakeEvent {
  request?: ReturnType<typeof request> & { clone?: unknown };
  respondWith: ReturnType<typeof vi.fn>;
  waitUntil(promise: Promise<unknown>): void;
  preloadResponse?: Promise<Response | undefined>;
  data?: unknown;
}

function runWorker(script: string, fetchImpl: (req: unknown) => Promise<Response>) {
  const listeners: Record<string, (event: FakeEvent) => void> = {};
  const stores = new Map<string, Map<string, Response>>();
  const key = (req: unknown) => (typeof req === 'string' ? `${ORIGIN}${req}` : (req as { url: string }).url);
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      match: async (req: unknown) => store.get(key(req))?.clone(),
      put: async (req: unknown, res: Response) => void store.set(key(req), res),
      addAll: async (urls: string[]) => {
        for (const url of urls) store.set(key(url), new Response(`precached ${url}`));
      },
    };
  };
  const caches = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (req: unknown, options?: { cacheName?: string }) =>
      (await open(options?.cacheName ?? [...stores.keys()][0]!)).match(req),
  };
  const registration = {
    navigationPreload: { enable: vi.fn(async () => {}) },
    unregister: vi.fn(async () => true),
  };
  const self = {
    location: { origin: ORIGIN },
    registration,
    clients: { claim: vi.fn(async () => {}) },
    skipWaiting: vi.fn(),
    addEventListener: (type: string, listener: (event: FakeEvent) => void) => (listeners[type] = listener),
  };
  new Function('self', 'caches', 'fetch', script)(self, caches, fetchImpl);
  const pending: Promise<unknown>[] = [];
  const dispatch = async (type: string, init: Partial<FakeEvent> = {}) => {
    const event: FakeEvent = {
      respondWith: vi.fn(),
      waitUntil: (promise) => void pending.push(promise),
      ...init,
    };
    listeners[type]!(event);
    await Promise.all(pending.splice(0));
    const responded = event.respondWith.mock.calls[0]?.[0] as Promise<Response> | undefined;
    return { event, response: responded ? await responded : undefined };
  };
  return { dispatch, stores, self, registration, listeners };
}

describe('the service worker script', () => {
  it('precaches the offline page, takes over and drops other builds’ caches', async () => {
    const worker = runWorker(serviceWorkerScript('b2'), vi.fn());
    worker.stores.set('darkbeacon-static-b1', new Map());
    worker.stores.set('someone-else', new Map());
    await worker.dispatch('install');
    expect([...worker.stores.get('darkbeacon-static-b2')!.keys()]).toEqual(
      PRECACHE.map((p) => `${ORIGIN}${p}`),
    );
    await worker.dispatch('activate');
    expect([...worker.stores.keys()].sort()).toEqual(['darkbeacon-static-b2', 'someone-else']);
    expect(worker.registration.navigationPreload.enable).toHaveBeenCalled();
    expect(worker.self.clients.claim).toHaveBeenCalled();
    // It waits for the page to say so before replacing a running worker.
    expect(worker.self.skipWaiting).not.toHaveBeenCalled();
    await worker.dispatch('message', { data: { type: 'SKIP_WAITING' } });
    expect(worker.self.skipWaiting).toHaveBeenCalledOnce();
  });

  it('does not intercept API calls at all', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const worker = runWorker(serviceWorkerScript('b1'), fetchImpl);
    const { event } = await worker.dispatch('fetch', { request: request('/api/maps') });
    expect(event.respondWith).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('serves build output from the cache after the first fetch', async () => {
    // Same-origin answers are `basic`; a Response made here reports `default`.
    const basic = (): Response => {
      const res = new Response('chunk');
      Object.defineProperty(res, 'type', { value: 'basic' });
      res.clone = basic;
      return res;
    };
    const fetchImpl = vi.fn(async () => basic());
    const worker = runWorker(serviceWorkerScript('b1'), fetchImpl);
    const asset = request('/_next/static/chunks/a1.js');
    expect(await (await worker.dispatch('fetch', { request: asset })).response!.text()).toBe('chunk');
    expect(await (await worker.dispatch('fetch', { request: asset })).response!.text()).toBe('chunk');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('loads pages from the network and shows the offline page without one', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>map</html>'));
    const worker = runWorker(serviceWorkerScript('b1'), fetchImpl);
    await worker.dispatch('install');
    const online = await worker.dispatch('fetch', {
      request: page('/m/home'),
      preloadResponse: Promise.resolve(undefined),
    });
    expect(await online.response!.text()).toBe('<html>map</html>');
    expect(worker.stores.get('darkbeacon-static-b1')!.has(`${ORIGIN}/m/home`)).toBe(false);

    fetchImpl.mockRejectedValue(new TypeError('Failed to fetch'));
    const offline = await worker.dispatch('fetch', {
      request: page('/m/home'),
      preloadResponse: Promise.resolve(undefined),
    });
    expect(await offline.response!.text()).toBe(`precached ${OFFLINE_PAGE}`);
  });

  it('uses the navigation preload when the browser made one', async () => {
    const fetchImpl = vi.fn();
    const worker = runWorker(serviceWorkerScript('b1'), fetchImpl);
    const { response } = await worker.dispatch('fetch', {
      request: page('/'),
      preloadResponse: Promise.resolve(new Response('preloaded')),
    });
    expect(await response!.text()).toBe('preloaded');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('switched off, removes itself and its caches', async () => {
    const worker = runWorker(killSwitchScript(), vi.fn());
    worker.stores.set('darkbeacon-static-b1', new Map());
    worker.stores.set('someone-else', new Map());
    await worker.dispatch('install');
    expect(worker.self.skipWaiting).toHaveBeenCalled();
    await worker.dispatch('activate');
    expect([...worker.stores.keys()]).toEqual(['someone-else']);
    expect(worker.registration.unregister).toHaveBeenCalled();
    expect(worker.listeners.fetch).toBeUndefined();
  });
});
