/**
 * Google Analytics 4 for an instance whose operator opts in (the hosted app.darkbeacon.space does).
 *
 * - Off unless `GA_MEASUREMENT_ID` (a `G-...` id) is in the environment of the running server. It
 *   is read per request, not at build time: the Docker image is the same for every instance, and
 *   a self-hosted one that does not set it gets no Google code at all.
 * - Google Consent Mode v2, advanced: every signal starts denied, so until the visitor accepts
 *   measurement GA only receives cookieless pings and sets no cookie. A choice stored earlier
 *   (c15t's `c15t` localStorage entry) is applied before gtag.js loads. The ad signals stay
 *   denied: nothing in the app advertises.
 * - Browsers that send Do Not Track or Global Privacy Control get no Google tag at all, as for
 *   the anonymous telemetry (docs/telemetry.md).
 * - Page views are sent by the app on every route change (`send_page_view: false` in the config,
 *   so the first page is not counted twice), with the address reduced to its route: map slugs,
 *   public link tokens, query strings and fragments never reach Google, nor do page titles, user
 *   ids or character names.
 */

/** The opt-in switch, checked on the server. Null: no analytics on this instance. */
export function gaMeasurementId(env: Record<string, string | undefined>): string | null {
  const value = (env.GA_MEASUREMENT_ID ?? '').trim();
  return /^G-[A-Z0-9]+$/.test(value) ? value : null;
}

/** The c15t storage key and the category GA follows. */
export const CONSENT_STORAGE_KEY = 'c15t';

/** Do Not Track or Global Privacy Control. */
export function privacySignal(nav: Navigator, win: Window): boolean {
  const n = nav as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const values: unknown[] = [
    n.doNotTrack,
    n.msDoNotTrack,
    (win as Window & { doNotTrack?: string }).doNotTrack,
    n.globalPrivacyControl,
  ];
  return values.some((v) => v === '1' || v === 'yes' || v === true);
}

/** Whether c15t has a stored grant for `measurement` (its v3 record in localStorage). */
export function storedMeasurementGrant(storage: Pick<Storage, 'getItem'> | undefined): boolean {
  try {
    const raw = storage?.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return false;
    const record = JSON.parse(raw) as { categories?: { measurement?: { value?: unknown } } } | null;
    return record?.categories?.measurement?.value === true;
  } catch {
    return false;
  }
}

/**
 * The page as GA sees it: the route, never what is in it. Map slugs and public link tokens
 * become placeholders; anything unknown becomes `/other`.
 */
export function routeOf(pathname: string): string {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (/^\/m\/[^/]+$/.test(path)) return '/m/[map]';
  if (/^\/p\/[^/]+$/.test(path)) return '/p/[link]';
  const known = [
    '/',
    '/login',
    '/maps',
    '/account',
    '/admin',
    '/import',
    '/jump',
    '/characters',
    '/changelog',
    '/oauth/authorize',
    '/support',
  ];
  return known.includes(path) ? path : '/other';
}

type Gtag = (...args: unknown[]) => void;
type GaWindow = Window & { dataLayer?: unknown[]; gtag?: Gtag };

/**
 * Sets up `gtag` with the Consent Mode defaults and the stored choice, and configures the
 * property. Returns null (and touches nothing) under Do Not Track / GPC. Loading gtag.js itself
 * is `loadGtag`, called after this.
 */
export function bootstrapGa(win: Window, id: string): Gtag | null {
  if (privacySignal(win.navigator, win)) return null;
  const w = win as GaWindow;
  w.dataLayer = w.dataLayer ?? [];
  const gtag: Gtag = function () {
    // gtag.js reads the `arguments` objects, not arrays.
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  };
  w.gtag = gtag;
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
    personalization_storage: 'denied',
    wait_for_update: 500,
  });
  gtag('set', 'ads_data_redaction', true);
  let storage: Storage | undefined;
  try {
    storage = win.localStorage;
  } catch {
    storage = undefined;
  }
  if (storedMeasurementGrant(storage)) gtag('consent', 'update', { analytics_storage: 'granted' });
  gtag('js', new Date());
  // Before the config: whatever GA sends on its own from the start (enhanced measurement such as
  // site search, scrolls) already sees the reduced page, never the real address or title.
  gtag('set', pageFields(win.location.origin, win.location.pathname, win.document.referrer));
  gtag('config', id, { send_page_view: false });
  return gtag;
}

/** Adds gtag.js to the page (once). */
export function loadGtag(doc: Document, id: string): void {
  if (doc.querySelector('script[data-dbk-gtag]')) return;
  const script = doc.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  script.dataset.dbkGtag = '';
  doc.head.append(script);
}

/**
 * The referrer as GA sees it: another site by its origin only, a page of this instance by its
 * route (so a public link token in the previous address never leaks).
 */
export function referrerOf(referrer: string, origin: string): string {
  if (!referrer) return '';
  try {
    const url = new URL(referrer);
    return url.origin === origin ? `${origin}${routeOf(url.pathname)}` : `${url.origin}/`;
  } catch {
    return '';
  }
}

/** What GA is told about a page: its route as address and title, and the reduced referrer. */
export function pageFields(origin: string, pathname: string, referrer: string) {
  const route = routeOf(pathname);
  return {
    page_location: `${origin}${route}`,
    page_title: route,
    page_referrer: referrerOf(referrer, origin),
  };
}

/** A page view for the route of `pathname` (address, title and referrer reduced). */
export function sendPageView(gtag: Gtag, origin: string, pathname: string, referrer: string): void {
  const page = pageFields(origin, pathname, referrer);
  // Every later hit (engagement, scroll) reports the same reduced address, title and referrer.
  gtag('set', page);
  gtag('event', 'page_view', page);
}

/** Follows the measurement choice. */
export function updateConsent(gtag: Gtag | undefined, measurement: boolean): void {
  gtag?.('consent', 'update', { analytics_storage: measurement ? 'granted' : 'denied' });
}

/** GA's cookies, removed by c15t when measurement is withdrawn. */
export const GA_COOKIES = ['_ga', '_ga_*'] as const;
