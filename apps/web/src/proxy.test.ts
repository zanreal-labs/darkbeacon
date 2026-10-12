import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { safeNext } from './lib/safe-next';
import { proxy } from './proxy';

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://darkbeacon.test${path}`, { headers: cookie ? { cookie } : {} });

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
    // Behind a TLS-terminating proxy the visitor's own address is kept.
    const forwarded = new NextRequest('http://127.0.0.1:3001/admin', {
      headers: { host: '127.0.0.1:3001', 'x-forwarded-host': 'maps.example', 'x-forwarded-proto': 'https' },
    });
    expect((await proxy(forwarded)).headers.get('location')).toBe('https://maps.example/login?next=%2Fadmin');

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
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});
