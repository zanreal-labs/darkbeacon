/**
 * Cookie consent, with c15t (@c15t/core): the banner and the settings dialog in
 * components/Consent.astro are plain markup, this drives them.
 *
 * - Offline mode: no consent backend. The choice is kept in this browser by c15t (a `c15t`
 *   first-party cookie and localStorage entry, 365 days), written only once the visitor chooses.
 *   With no location to go on, c15t applies its Europe opt-in policy: the banner is shown, and
 *   nothing optional is on until it is accepted.
 * - Categories: `necessary` (always; it only remembers the choice) and `measurement` (PostHog
 *   with a stored id, scripts/analytics.ts). There is no marketing category, as nothing on the
 *   site advertises. Vercel Web Analytics stays outside the banner: it sets no cookie and keeps
 *   nothing in the browser (see /privacy).
 * - Withdrawal: c15t removes PostHog's cookies and storage and reloads the page, so the code that
 *   already ran under consent is gone and PostHog starts again in cookieless mode.
 *
 * Google Consent Mode v2: when GA4 is on (components/Consent.astro), `measurement` drives
 * `analytics_storage`: granted on accept, denied again on withdrawal (which also deletes the
 * `_ga` cookies). The ad signals stay denied, as there is no marketing category.
 *
 * All of it loads when the browser is idle after the first paint, so neither the consent code
 * nor PostHog competes with the page for bandwidth or the main thread.
 */
import { POSTHOG_STORAGE, startAnalytics, syncAnalyticsConsent } from './analytics';

/** Google Analytics cookies, on this host and on the parent domain GA writes them to. */
const GA_COOKIES = ['_ga', '_ga_*'];

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

type Snapshot = import('@c15t/core').ConsentSnapshot;
type Runtime = import('@c15t/core/runtime').ConsentRuntime;

const root = document.querySelector<HTMLElement>('[data-consent]');
const banner = root?.querySelector<HTMLElement>('[data-consent-banner]');
const dialog = root?.querySelector<HTMLDialogElement>('[data-consent-dialog]');
const measurementToggle = dialog?.querySelector<HTMLInputElement>('input[name="measurement"]');

let runtime: Runtime | undefined;
let booting: Promise<Runtime> | undefined;

const boot = (): Promise<Runtime> => {
  booting ??= (async () => {
    const [{ createConsentRuntime }, { offline, getRootDomain }] = await Promise.all([
      import('@c15t/core/runtime'),
      import('@c15t/core'),
    ]);
    const created = createConsentRuntime({
      mode: offline(),
      consentCategories: ['necessary', 'measurement'],
      clearOnRevocation: {
        measurement: {
          cookies: [
            ...POSTHOG_STORAGE,
            ...GA_COOKIES,
            ...GA_COOKIES.map((name) => ({ name, domain: getRootDomain() })),
          ],
          localStorage: POSTHOG_STORAGE,
          sessionStorage: POSTHOG_STORAGE,
        },
      },
      reloadOnConsentRevoked: true,
      iframeBlocker: false,
      windowDebug: false,
    });
    runtime = created;
    created.kernel.subscribe(render);
    created.start();
    render(created.kernel.getSnapshot());
    return created;
  })();
  return booting;
};

let analyticsStarted = false;
let lastMeasurement: boolean | undefined;

function render(snapshot: Snapshot) {
  if (!root || snapshot.policyPending) return;
  const measurement = snapshot.effectivePermissions.measurement === true;

  // PostHog starts only once the stored choice is known (and c15t has swept the storage of a
  // withdrawn one), so it never begins with an id it may no longer keep.
  if (!analyticsStarted) {
    analyticsStarted = true;
    void startAnalytics();
  }
  if (measurement !== lastMeasurement) {
    // The first run only confirms what the stored choice already set (or the defaults).
    if (lastMeasurement !== undefined || measurement) {
      window.gtag?.('consent', 'update', { analytics_storage: measurement ? 'granted' : 'denied' });
    }
    lastMeasurement = measurement;
    void syncAnalyticsConsent(measurement);
  }

  const ui = snapshot.activeUI;
  const showBanner = ui === 'banner' || (ui === null && snapshot.promptRequirement.kind === 'choice');
  if (banner) banner.hidden = !showBanner;
  document.documentElement.toggleAttribute('data-consent-open', showBanner);

  if (dialog) {
    if (ui === 'dialog' && !dialog.open) {
      if (measurementToggle) measurementToggle.checked = measurement;
      dialog.showModal();
    } else if (ui !== 'dialog' && dialog.open) {
      dialog.close();
    }
  }
}

const save = async (input: 'all' | 'none' | { measurement: boolean }) => {
  const current = runtime ?? (await boot());
  const snapshot = current.kernel.getSnapshot();
  const uiSource = snapshot.activeUI === 'dialog' ? 'dialog' : 'banner';
  await current.kernel.commands.save(input, { uiSource });
  current.kernel.set.activeUI('none');
};

const openSettings = async () => {
  const current = runtime ?? (await boot());
  current.kernel.set.activeUI('dialog');
};

root?.addEventListener('click', (event) => {
  const action = (event.target as Element | null)?.closest<HTMLElement>('[data-consent-action]')?.dataset.consentAction;
  if (action === 'accept') void save('all');
  else if (action === 'reject') void save('none');
  else if (action === 'save') void save({ measurement: measurementToggle?.checked === true });
  else if (action === 'customise') void openSettings();
});

// Escape or a click on the backdrop closes the dialog without saving; the banner comes back
// while no choice has been made.
dialog?.addEventListener('cancel', (event) => {
  event.preventDefault();
  runtime?.kernel.set.activeUI(runtime.kernel.getSnapshot().explicitChoice ? 'none' : 'banner');
});
dialog?.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
});

// "Cookie settings" links anywhere on the page (the footer, /privacy).
document.addEventListener('click', (event) => {
  const link = (event.target as Element | null)?.closest('[data-cookie-settings]');
  if (!link) return;
  event.preventDefault();
  void openSettings();
});

// After the first paint, when the browser is idle.
const idle = (fn: () => void) =>
  'requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 1500);
if (document.readyState === 'complete') idle(() => void boot());
else addEventListener('load', () => idle(() => void boot()), { once: true });
