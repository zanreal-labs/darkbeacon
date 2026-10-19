// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({ connection: async () => {} }));

import { AnalyticsSlot } from './AnalyticsSlot';
import { AnalyticsClient } from './AnalyticsClient';
import {
  bootstrapGa,
  gaMeasurementId,
  loadGtag,
  referrerOf,
  routeOf,
  sendPageView,
  storedMeasurementGrant,
  updateConsent,
} from './ga';

type GaWindow = Window & { dataLayer?: IArguments[]; gtag?: unknown };
const calls = () => ((window as GaWindow).dataLayer ?? []).map((args) => Array.from(args));

const grant = JSON.stringify({
  version: 3,
  categories: {
    measurement: { value: true, confirmedAt: 1, basis: { kind: 'choice-v1', fingerprint: 'x' } },
  },
});
const denial = JSON.stringify({ version: 3, categories: { measurement: { value: false } } });

beforeEach(() => {
  delete (window as GaWindow).dataLayer;
  delete (window as GaWindow).gtag;
  localStorage.clear();
  document.head.querySelectorAll('script').forEach((s) => s.remove());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GA_MEASUREMENT_ID gating', () => {
  it('accepts only a G- measurement id', () => {
    expect(gaMeasurementId({})).toBeNull();
    expect(gaMeasurementId({ GA_MEASUREMENT_ID: '' })).toBeNull();
    expect(gaMeasurementId({ GA_MEASUREMENT_ID: 'UA-1234-1' })).toBeNull();
    expect(gaMeasurementId({ GA_MEASUREMENT_ID: 'G-abc' })).toBeNull();
    expect(gaMeasurementId({ GA_MEASUREMENT_ID: 'G-2M2RQT86N1"><script>' })).toBeNull();
    expect(gaMeasurementId({ GA_MEASUREMENT_ID: ' G-2M2RQT86N1 ' })).toBe('G-2M2RQT86N1');
  });

  it('renders nothing on an instance without it, the consent client with it', async () => {
    vi.stubEnv('GA_MEASUREMENT_ID', '');
    expect(await AnalyticsSlot()).toBeNull();
    vi.stubEnv('GA_MEASUREMENT_ID', 'G-2M2RQT86N1');
    const element = await AnalyticsSlot();
    expect(element?.type).toBe(AnalyticsClient);
    expect(element?.props).toEqual({ id: 'G-2M2RQT86N1' });
  });
});

describe('Consent Mode bootstrap', () => {
  it('starts with every signal denied and the page view left to the app', () => {
    const gtag = bootstrapGa(window, 'G-TEST1');
    expect(gtag).toBeTypeOf('function');
    const [first, ...rest] = calls();
    expect(first).toEqual([
      'consent',
      'default',
      expect.objectContaining({
        analytics_storage: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        wait_for_update: 500,
      }),
    ]);
    expect(rest.some(([cmd, kind]) => cmd === 'consent' && kind === 'update')).toBe(false);
    expect(rest).toContainEqual(['config', 'G-TEST1', { send_page_view: false }]);
    // The reduced page is set before the config, so nothing GA sends on its own sees the real one.
    const page = rest.findIndex(
      ([cmd, fields]) =>
        cmd === 'set' && typeof fields === 'object' && fields !== null && 'page_location' in fields,
    );
    expect(page).toBeGreaterThanOrEqual(0);
    expect(page).toBeLessThan(rest.findIndex(([cmd]) => cmd === 'config'));
    expect(document.cookie).toBe('');
  });

  it('applies a stored grant before the config, i.e. before gtag.js can send anything', () => {
    localStorage.setItem('c15t', grant);
    bootstrapGa(window, 'G-TEST1');
    const list = calls();
    const update = list.findIndex(([cmd, kind]) => cmd === 'consent' && kind === 'update');
    const config = list.findIndex(([cmd]) => cmd === 'config');
    expect(list[update]).toEqual(['consent', 'update', { analytics_storage: 'granted' }]);
    expect(update).toBeGreaterThan(0);
    expect(update).toBeLessThan(config);
  });

  it('reads only a real grant from the c15t record', () => {
    const store = (value: string | null) => ({ getItem: () => value });
    expect(storedMeasurementGrant(store(grant))).toBe(true);
    expect(storedMeasurementGrant(store(denial))).toBe(false);
    expect(storedMeasurementGrant(store('not json'))).toBe(false);
    expect(storedMeasurementGrant(store(null))).toBe(false);
    expect(storedMeasurementGrant(undefined)).toBe(false);
  });

  it('does nothing at all under Do Not Track or Global Privacy Control', () => {
    Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
    expect(bootstrapGa(window, 'G-TEST1')).toBeNull();
    expect((window as GaWindow).dataLayer).toBeUndefined();
    delete (navigator as { doNotTrack?: string }).doNotTrack;
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
    expect(bootstrapGa(window, 'G-TEST1')).toBeNull();
    delete (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl;
  });

  it('follows the consent and loads gtag.js once', () => {
    const gtag = bootstrapGa(window, 'G-TEST1')!;
    updateConsent(gtag, true);
    updateConsent(gtag, false);
    expect(calls().slice(-2)).toEqual([
      ['consent', 'update', { analytics_storage: 'granted' }],
      ['consent', 'update', { analytics_storage: 'denied' }],
    ]);
    loadGtag(document, 'G-TEST1');
    loadGtag(document, 'G-TEST1');
    const scripts = document.head.querySelectorAll('script[data-dbk-gtag]');
    expect(scripts).toHaveLength(1);
    expect((scripts[0] as HTMLScriptElement).src).toBe('https://www.googletagmanager.com/gtag/js?id=G-TEST1');
  });
});

describe('page views', () => {
  it('reduce addresses to routes', () => {
    expect(routeOf('/')).toBe('/');
    expect(routeOf('/maps/')).toBe('/maps');
    expect(routeOf('/m/our-secret-chain')).toBe('/m/[map]');
    expect(routeOf('/p/tok_abcdef')).toBe('/p/[link]');
    expect(routeOf('/admin')).toBe('/admin');
    expect(routeOf('/m/a/b')).toBe('/other');
    expect(routeOf('/wp-login.php')).toBe('/other');
  });

  it('reduce referrers: other sites by origin, this instance by route', () => {
    const origin = 'https://app.darkbeacon.space';
    expect(referrerOf('', origin)).toBe('');
    expect(referrerOf('https://darkbeacon.space/features?x=1', origin)).toBe('https://darkbeacon.space/');
    expect(referrerOf('https://app.darkbeacon.space/p/tok_secret', origin)).toBe(`${origin}/p/[link]`);
    expect(referrerOf('not a url', origin)).toBe('');
  });

  it('send the route as location and title, never the real address', () => {
    const gtag = bootstrapGa(window, 'G-TEST1')!;
    sendPageView(gtag, 'https://app.darkbeacon.space', '/m/our-chain', 'https://darkbeacon.space/');
    const page = {
      page_location: 'https://app.darkbeacon.space/m/[map]',
      page_title: '/m/[map]',
      page_referrer: 'https://darkbeacon.space/',
    };
    expect(calls().slice(-2)).toEqual([
      ['set', page],
      ['event', 'page_view', page],
    ]);
    expect(JSON.stringify(calls())).not.toContain('our-chain');
  });
});
