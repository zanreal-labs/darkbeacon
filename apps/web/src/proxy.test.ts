import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { safeNext } from './lib/safe-next';
import { proxy } from './proxy';

/** A browser opening a page (what the proxy signs demo visitors in for). */
const request = (
  path: string,
  cookie?: string,
  init: { method?: string; headers?: Record<string, string> } = {},
) =>
  new NextRequest(`http://darkbeacon.test${path}`, {
    method: init.method ?? 'GET',
    headers: { 'sec-fetch-dest': 'document', ...(cookie ? { cookie } : {}), ...init.headers },
  });

function fakeApi(answer: () => Response) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => answer());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('proxy', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lets visits with a session through without asking the API', async () => {
    const fetch = fakeApi(() => new Response(null, { status: 500 }));
    const response = await proxy(request('/m/home', 'dbk_session=abc'));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect((await proxy(request('/', 'ww_session=old'))).headers.get('x-middleware-next')).toBe('1');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('signs a signed-out visit in as the demo account before the page renders', async () => {
    const fetch = fakeApi(
      () =>
        new Response('{}', {
          status: 200,
          headers: [
            ['set-cookie', 'dbk_session=demo; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax'],
            ['set-cookie', 'dbk_demo_out=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'],
          ],
        }),
    );
    const response = await proxy(request('/m/demo-chain', 'dbk_theme=dark'));
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/auth\/demo$/),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(response.headers.get('x-middleware-next')).toBe('1');
    // The browser keeps the session ...
    expect(response.headers.getSetCookie()).toEqual([
      'dbk_session=demo; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax',
      'dbk_demo_out=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
    ]);
    // ... and this very render already sees it.
    expect(response.headers.get('x-middleware-override-headers')).toContain('cookie');
    expect(response.headers.get('x-middleware-request-cookie')).toBe('dbk_theme=dark; dbk_session=demo');
  });

  it('sends signed-out visits to the sign-in page when there is no demo, or after signing out of it', async () => {
    fakeApi(() => new Response(null, { status: 404 }));
    const response = await proxy(request('/m/home?tab=labels'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://darkbeacon.test/login?next=%2Fm%2Fhome%3Ftab%3Dlabels',
    );
    expect((await proxy(request('/'))).headers.get('location')).toBe('http://darkbeacon.test/login');
    // A host named in forwarded headers is not trusted: the redirect stays on the request's own
    // address (Next.js turns it into a relative Location).
    const forwarded = new NextRequest('http://web.internal:3001/admin', {
      headers: {
        host: 'web.internal:3001',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'https',
      },
    });
    expect((await proxy(forwarded)).headers.get('location')).toBe(
      'http://web.internal:3001/login?next=%2Fadmin',
    );

    const fetch = fakeApi(() => new Response(null, { status: 500 }));
    const optedOut = await proxy(request('/', 'dbk_demo_out=1'));
    expect(optedOut.headers.get('location')).toBe('http://darkbeacon.test/login');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows the sign-in page only when signed out, and drops a stale session on request', async () => {
    const fetch = fakeApi(() => new Response(null, { status: 500 }));
    expect((await proxy(request('/login'))).headers.get('x-middleware-next')).toBe('1');
    expect((await proxy(request('/login?next=%2Fadmin', 'dbk_session=x'))).headers.get('location')).toBe(
      'http://darkbeacon.test/admin',
    );
    const reset = await proxy(request('/login?reset=1&next=%2Fadmin', 'dbk_session=stale'));
    expect(reset.headers.get('location')).toBe('http://darkbeacon.test/admin');
    expect(reset.headers.getSetCookie().join('\n')).toMatch(
      /dbk_session=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('only follows same-site paths after sign-in', () => {
    expect(safeNext('/m/x')).toBe('/m/x');
    expect(safeNext('/m/x?tab=labels#a')).toBe('/m/x?tab=labels#a');
    expect(safeNext('/a/../m/x')).toBe('/m/x');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('/\\evil.example/phish')).toBe('/');
    expect(safeNext('/\t/evil.example')).toBe('/');
    expect(safeNext('/\n/evil.example')).toBe('/');
    expect(safeNext('/a/..//evil.example')).toBe('/');
    expect(safeNext('/%2F/evil.example')).toBe('/%2F/evil.example');
    expect(safeNext(null)).toBe('/');
  });

  it('never redirects off-site from the sign-in page', async () => {
    fakeApi(() => new Response(null, { status: 500 }));
    // Each of these resolved to http://evil.example/... before.
    for (const next of [
      '/%5Cevil.example/phish',
      '/%09/evil.example',
      '/%5C%09evil.example',
      '/a/..//evil.example',
    ]) {
      for (const cookie of [undefined, 'dbk_session=x']) {
        const response = await proxy(request(`/login?reset=1&next=${next}`, cookie));
        expect(new URL(response.headers.get('location')!).host).toBe('darkbeacon.test');
        const signedIn = await proxy(request(`/login?next=${next}`, 'dbk_session=x'));
        expect(new URL(signedIn.headers.get('location')!).host).toBe('darkbeacon.test');
      }
    }
  });

  it('signs in only browsers opening a page, not crawlers, prefetches or unknown paths', async () => {
    // Past the minute an earlier "no demo here" answer is remembered for.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 5 * 60_000);
    const fetch = fakeApi(() => new Response(null, { status: 500 }));
    for (const path of [
      '/robots.txt',
      '/wp-login.php',
      '/apple-touch-icon.png',
      '/.well-known/security.txt',
      '/m',
    ]) {
      const response = await proxy(request(path));
      expect(response.headers.get('x-middleware-next'), path).toBe('1');
    }
    // Not a page visit: no session is created, the sign-in page is where to go.
    const head = await proxy(request('/', undefined, { method: 'HEAD' }));
    expect(head.headers.get('location')).toBe('http://darkbeacon.test/login');
    const bot = new NextRequest('http://darkbeacon.test/m/demo-chain', { headers: { 'user-agent': 'bot' } });
    expect((await proxy(bot)).headers.get('location')).toBe(
      'http://darkbeacon.test/login?next=%2Fm%2Fdemo-chain',
    );
    const prefetch = await proxy(
      request('/admin', undefined, { headers: { rsc: '1', 'next-router-prefetch': '1' } }),
    );
    expect(prefetch.status).toBe(307);
    expect(fetch).not.toHaveBeenCalled();

    const curl = { accept: 'text/html,*/*', 'user-agent': 'curl/8.5.0' };
    expect((await proxy(new NextRequest('http://darkbeacon.test/', { headers: curl }))).status).toBe(307);
    expect(fetch).not.toHaveBeenCalled();

    // A client-side navigation, a document load, and a browser on plain HTTP (no fetch metadata
    // there) do ask.
    const firefox = {
      accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
    };
    await proxy(new NextRequest('http://darkbeacon.test/', { headers: firefox }));
    await proxy(
      request('/m/demo-chain/settings', undefined, { headers: { 'sec-fetch-dest': 'empty', rsc: '1' } }),
    );
    await proxy(request('/account'));
    expect(fetch).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
