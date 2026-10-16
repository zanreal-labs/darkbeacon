// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeSupportContext, SUPPORT_MESSAGE_SOURCE, type SupportClientDto } from '@darkbeacon/shared';
import {
  browserFamily,
  buildSupportContext,
  fetchUnread,
  openSupportPopup,
  osFamily,
  provideMapCounts,
  recentClientErrors,
  recordClientError,
  resetClientErrors,
  supportPage,
  supportUrl,
} from './support';

const HUB = 'https://app.darkbeacon.space';
const ME = 'https://map.example.com';

const client = (over: Partial<SupportClientDto> = {}): SupportClientDto => ({
  hubUrl: HUB,
  inApp: false,
  handle: null,
  localInbox: false,
  instance: { appVersion: '0.1.0', commit: 'abcdef123456', db: 'postgres', loginMethod: 'eve', demo: false },
  ...over,
});

const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';

describe('support context', () => {
  beforeEach(() => {
    resetClientErrors();
    provideMapCounts(null);
  });

  it('names pages by kind, never by address', () => {
    expect(supportPage('/m/home-chain')).toBe('map');
    expect(supportPage('/')).toBe('map');
    expect(supportPage('/admin')).toBe('admin');
    expect(supportPage('/oauth/authorize')).toBe('oauth_consent');
    expect(supportPage('/p/secret-token')).toBe('other');
    expect(supportPage('/wp-login.php')).toBe('other');
  });

  it('reads browser and system families', () => {
    expect([browserFamily(FIREFOX), osFamily(FIREFOX)]).toEqual(['firefox', 'linux']);
    expect([browserFamily(SAFARI_IOS), osFamily(SAFARI_IOS)]).toEqual(['safari', 'ios']);
    expect([browserFamily(EDGE), osFamily(EDGE)]).toEqual(['edge', 'windows']);
    expect(browserFamily('curl/8')).toBe('other');
  });

  it('keeps the last five errors, scrubbed', () => {
    for (let i = 1; i <= 7; i++) recordClientError(`Error ${i} at "J10010${i}"`);
    recordClientError(undefined);
    expect(recentClientErrors()).toEqual([
      'Error 3 at <str>',
      'Error 4 at <str>',
      'Error 5 at <str>',
      'Error 6 at <str>',
      'Error 7 at <str>',
    ]);
  });

  it('carries only the allow-list, with the instance address and map size as opt-ins', () => {
    recordClientError('TypeError: x is undefined at https://map.example.com/m/home-chain');
    provideMapCounts(() => ({ systems: 12, connections: 11, signatures: 40 }));
    const { context, optional } = buildSupportContext({
      client: client(),
      location: { pathname: '/m/home-chain', search: '?settings=access', host: 'Map.Example.com' },
      theme: { preference: 'my-own-theme', scheme: 'dark' },
      navigator: { userAgent: FIREFOX, language: 'pl-PL' },
      width: 1440,
    });
    expect(context).toEqual({
      appVersion: '0.1.0',
      commit: 'abcdef123456',
      db: 'postgres',
      login: 'eve',
      page: 'map',
      section: 'access',
      viewport: 'desktop',
      browser: 'firefox',
      os: 'linux',
      locale: 'pl-PL',
      theme: 'custom',
      scheme: 'dark',
      demo: false,
      errors: ['TypeError: x is undefined at <url>'],
    });
    expect(JSON.stringify(context)).not.toContain('home-chain');
    expect(optional).toEqual({
      instanceHost: 'map.example.com',
      mapCounts: { systems: 12, connections: 11, signatures: 40 },
    });
    // Off the map page there is no map size to offer.
    expect(
      buildSupportContext({
        client: client(),
        location: { pathname: '/admin', search: '?tab=nonsense', host: 'map.example.com' },
        theme: { preference: 'system', scheme: 'light' },
        navigator: { userAgent: FIREFOX, language: 'en' },
        width: 390,
      }),
    ).toMatchObject({
      context: { page: 'admin', viewport: 'phone' },
      optional: { instanceHost: 'map.example.com' },
    });
  });

  it('puts a short context in the URL: no errors, no opt-ins', () => {
    const url = new URL(
      supportUrl(HUB, 'ticket', ME, {
        appVersion: '0.1.0',
        errors: ['boom'],
        instanceHost: 'map.example.com',
      }),
    );
    expect(url.origin).toBe(HUB);
    expect(url.pathname).toBe('/support');
    expect(url.searchParams.get('origin')).toBe(ME);
    expect(decodeSupportContext(url.searchParams.get('ctx'))).toEqual({
      appVersion: '0.1.0',
      instanceHost: 'map.example.com',
    });
  });
});

describe('support popup handshake', () => {
  type Listener = (event: MessageEvent) => void;

  function fakeWindow() {
    const listeners: Listener[] = [];
    const posted: Array<{ message: unknown; target: string }> = [];
    const popup = {
      closed: false,
      postMessage: (message: unknown, target: string) => posted.push({ message, target }),
    };
    const win = {
      location: { origin: ME },
      open: vi.fn(() => popup),
      addEventListener: (_: string, listener: Listener) => listeners.push(listener),
      removeEventListener: (_: string, listener: Listener) =>
        listeners.splice(listeners.indexOf(listener), 1),
      setInterval: (fn: () => void) => setInterval(fn, 1000),
      clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
    };
    const deliver = (data: unknown, origin: string, source: unknown = popup) =>
      [...listeners].forEach((l) => l({ data, origin, source } as unknown as MessageEvent));
    return { win: win as unknown as Window, popup, posted, deliver, listeners };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('answers the hub’s ready with the context, only to the hub, only from the popup', () => {
    const { win, popup, posted, deliver, listeners } = fakeWindow();
    const handles: string[] = [];
    const parts = { context: { appVersion: '0.1.0' }, optional: { instanceHost: 'map.example.com' } };
    expect(
      openSupportPopup({
        hubUrl: HUB,
        kind: 'ticket',
        parts,
        hasHandle: false,
        onHandle: (h) => handles.push(h),
        win,
      }),
    ).toBe(true);
    const ready = { source: SUPPORT_MESSAGE_SOURCE, type: 'ready' };

    // Not the hub's origin, or not the popup: ignored.
    deliver(ready, 'https://evil.example');
    deliver(ready, HUB, {});
    deliver({ type: 'ready' }, HUB);
    expect(posted).toEqual([]);

    deliver(ready, HUB);
    expect(posted).toEqual([
      {
        target: HUB,
        message: {
          source: SUPPORT_MESSAGE_SOURCE,
          type: 'context',
          context: parts.context,
          optional: parts.optional,
          hasHandle: false,
        },
      },
    ]);

    const handle = `dbsh_${'a'.repeat(43)}`;
    deliver({ source: SUPPORT_MESSAGE_SOURCE, type: 'handle', handle }, 'https://evil.example');
    deliver({ source: SUPPORT_MESSAGE_SOURCE, type: 'handle', handle }, HUB);
    expect(handles).toEqual([handle]);

    // The listener goes when the popup closes.
    popup.closed = true;
    vi.advanceTimersByTime(1500);
    expect(listeners).toHaveLength(0);
  });

  it('says so when the popup was blocked', () => {
    const { win } = fakeWindow();
    (win.open as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);
    expect(
      openSupportPopup({
        hubUrl: HUB,
        kind: 'feedback',
        parts: { context: {}, optional: {} },
        hasHandle: true,
        onHandle: () => {},
        win,
      }),
    ).toBe(false);
  });
});

describe('unread polling', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks the hub with the handle, without cookies, and notices a revoked handle', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let status = 200;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ unread: 2 }), { status });
      }),
    );
    const handle = `dbsh_${'b'.repeat(43)}`;
    expect(await fetchUnread(client({ handle }))).toBe(2);
    expect(calls[0]!.url).toBe(`${HUB}/api/support/unread?h=${handle}`);
    expect(calls[0]!.init).toMatchObject({ credentials: 'omit', mode: 'cors' });
    status = 404;
    expect(await fetchUnread(client({ handle }))).toBe('gone');
    expect(await fetchUnread(client({ handle: null }))).toBe(0);
    expect(await fetchUnread(client({ hubUrl: null }))).toBe(0);
    status = 200;
    // On the hub itself: same origin, with the hub session.
    expect(await fetchUnread(client({ inApp: true }))).toBe(2);
    expect(calls.at(-1)).toMatchObject({ url: '/api/support/unread', init: { credentials: 'same-origin' } });
  });
});
