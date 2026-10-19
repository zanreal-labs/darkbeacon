/**
 * Web analytics for the site: PostHog, cookieless until the visitor agrees to measurement.
 *
 * The project is the maintainers' Darkbeacon project (EU region), the same `phc_` key the app's
 * telemetry uses (packages/modules/telemetry/src/domain/defaults.ts). Every event carries
 * `origin: 'site'`, so site traffic is told apart from the app's `server` and `web` events.
 *
 * Requests go to this site's own /ingest path, which vercel.json rewrites to PostHog's EU hosts:
 * no third-party request leaves the page, and ad blockers that block posthog.com do not skew
 * the numbers.
 *
 * Two states, driven by the consent banner (scripts/consent.ts) and nothing else:
 *
 * - No consent (no choice yet, or rejected): `cookieless_mode: 'on_reject'` together with
 *   `opt_out_capturing_by_default` makes PostHog treat the visitor as rejected, so it counts
 *   pageviews in cookieless mode: no cookie, no localStorage, no sessionStorage, and the
 *   visitor is counted by a hash PostHog computes on its servers (salted daily, so a visitor
 *   cannot be followed across days). That needs "Cookieless server hash mode" switched on in
 *   the PostHog project (Settings, Web analytics), or PostHog drops these events.
 * - Measurement granted: `opt_in_capturing()` stores PostHog's id in a first-party cookie and
 *   localStorage, so returning visitors and sessions are counted properly.
 *
 * Withdrawing consent reloads the page (c15t's revocation reload) after c15t has removed the
 * ph_* cookies and storage, so PostHog starts again in cookieless mode.
 *
 * Browsers that send Do Not Track or Global Privacy Control get no PostHog at all, as in the
 * app (docs/telemetry.md).
 */
import type { PostHog } from 'posthog-js/dist/module.slim';

export const POSTHOG_KEY = 'phc_p6YkK99zADiGD2DqrcShQX5aJNdyAmxLNeAREYm3WXbG';

/** What PostHog keeps in the browser once it may (cookie, localStorage and sessionStorage names). */
export const POSTHOG_STORAGE = ['ph_*', '__ph_*'];

const yes = (value: unknown) => value === '1' || value === 'yes' || value === true;

/** Do Not Track or Global Privacy Control: no analytics script and no request at all. */
export const privacySignal = (): boolean => {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  return (
    yes(nav.doNotTrack) ||
    yes(nav.msDoNotTrack) ||
    yes((window as Window & { doNotTrack?: string }).doNotTrack) ||
    yes(nav.globalPrivacyControl)
  );
};

let instance: Promise<PostHog | null> | undefined;

/** Loads and starts PostHog once, in cookieless mode, or not at all under DNT / GPC. */
export const startAnalytics = (): Promise<PostHog | null> => {
  instance ??= (async () => {
    if (privacySignal()) return null;
    // The slim build with only the analytics extensions (pageviews, pageleaves, web vitals):
    // no replay, surveys, flags or toolbar code is shipped.
    const [{ default: posthog }, { AnalyticsExtensions }] = await Promise.all([
      import('posthog-js/dist/module.slim'),
      import('posthog-js/dist/extension-bundles'),
    ]);
    posthog.init(POSTHOG_KEY, {
      api_host: '/ingest',
      ui_host: 'https://eu.posthog.com',
      defaults: '2026-05-30',
      __extensionClasses: { ...AnalyticsExtensions },
      // Consent: cookieless until opted in (see the top of this file).
      cookieless_mode: 'on_reject',
      opt_out_capturing_by_default: true,
      // After consent: the id stays on darkbeacon.space, not on app.darkbeacon.space.
      persistence: 'localStorage+cookie',
      cross_subdomain_cookie: false,
      person_profiles: 'identified_only',
      // Pageviews on every load (and on history changes, should the site ever get any),
      // pageleaves for time on page and bounce rate, and Core Web Vitals.
      capture_pageview: 'history_change',
      capture_pageleave: true,
      capture_performance: { web_vitals: true, network_timing: false },
      // Nothing else: no clicks, no text, no input values, no recordings.
      autocapture: false,
      rageclick: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_exceptions: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_conversations: true,
      disable_product_tours: true,
      advanced_disable_flags: true,
      mask_personal_data_properties: true,
      respect_dnt: true,
    });
    posthog.register({ origin: 'site' });
    return posthog;
  })();
  return instance;
};

/** Follows the measurement consent: opt in once it is granted. */
export const syncAnalyticsConsent = async (measurement: boolean): Promise<void> => {
  const posthog = await startAnalytics();
  if (!posthog || !measurement) return;
  if (posthog.get_explicit_consent_status() !== 'granted') {
    // Starts persistence and sends this page's pageview again, now with the stored id.
    posthog.opt_in_capturing({ captureEventName: false });
  }
};
