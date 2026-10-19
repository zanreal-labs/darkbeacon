'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import type { ConsentRuntime } from '@c15t/core/runtime';
import { Button, Dialog, DialogContent, Switch } from '../ui';
import { GA_COOKIES, bootstrapGa, loadGtag, sendPageView, updateConsent } from './ga';
import styles from './analytics.module.css';

type Gtag = (...args: unknown[]) => void;

/**
 * Whether this instance asks for analytics consent, for the help menu's "Cookie settings" item,
 * and the way to open the dialog from there.
 */
let enabled = false;
let openSettings: (() => void) | null = null;
const listeners = new Set<() => void>();
const setEnabled = (value: boolean, open: (() => void) | null) => {
  enabled = value;
  openSettings = open;
  for (const listener of listeners) listener();
};

export function useCookieSettings(): (() => void) | null {
  const on = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => enabled,
    () => false,
  );
  return on ? () => openSettings?.() : null;
}

const idle = (fn: () => void) => {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout: 3000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, 1500);
  return () => window.clearTimeout(id);
};

/**
 * GA4 under Consent Mode, with a c15t consent banner and settings dialog. Rendered only when
 * the server found `GA_MEASUREMENT_ID` (AnalyticsSlot). See ga.ts for what is and is not sent.
 */
export function AnalyticsClient({ id }: { id: string }) {
  const pathname = usePathname();
  const gtag = useRef<Gtag | null>(null);
  const lastPath = useRef<string | null>(null);
  const [runtime, setRuntime] = useState<ConsentRuntime | null>(null);
  const [ui, setUi] = useState<'none' | 'banner' | 'dialog'>('none');
  const [measurement, setMeasurement] = useState(false);
  const [draft, setDraft] = useState(false);
  const [hasChoice, setHasChoice] = useState(false);

  // Consent Mode defaults and the stored choice first, then the consent runtime, then gtag.js,
  // all once the browser is idle after the first paint.
  useEffect(() => {
    let disposed = false;
    let created: ConsentRuntime | null = null;
    const cancel = idle(() => {
      const tag = bootstrapGa(window, id);
      if (!tag) return; // Do Not Track / GPC: nothing at all.
      gtag.current = tag;
      void (async () => {
        const [{ createConsentRuntime }, { offline, getRootDomain }] = await Promise.all([
          import('@c15t/core/runtime'),
          import('@c15t/core'),
        ]);
        if (disposed) return;
        created = createConsentRuntime({
          mode: offline(),
          consentCategories: ['necessary', 'measurement'],
          clearOnRevocation: {
            measurement: {
              cookies: [...GA_COOKIES, ...GA_COOKIES.map((name) => ({ name, domain: getRootDomain() }))],
            },
          },
          reloadOnConsentRevoked: true,
          iframeBlocker: false,
          windowDebug: false,
        });
        created.start();
        setRuntime(created);
        loadGtag(document, id);
        if (lastPath.current === null) {
          lastPath.current = window.location.pathname;
          sendPageView(tag, window.location.origin, window.location.pathname, document.referrer);
        }
      })();
    });
    return () => {
      disposed = true;
      cancel();
      created?.dispose();
    };
  }, [id]);

  // The banner, the dialog and Consent Mode follow the consent state.
  useEffect(() => {
    if (!runtime) return;
    let last: boolean | undefined;
    const render = () => {
      const snapshot = runtime.kernel.getSnapshot();
      if (snapshot.policyPending) return;
      const granted = snapshot.effectivePermissions.measurement === true;
      if (granted !== last) {
        if (last !== undefined || granted) updateConsent(gtag.current ?? undefined, granted);
        last = granted;
      }
      setMeasurement(granted);
      setHasChoice(snapshot.explicitChoice !== null);
      const active = snapshot.activeUI;
      setUi(
        active === 'dialog'
          ? 'dialog'
          : active === 'banner' || (active === null && snapshot.promptRequirement.kind === 'choice')
            ? 'banner'
            : 'none',
      );
    };
    render();
    setEnabled(true, () => {
      setDraft(runtime.kernel.getSnapshot().effectivePermissions.measurement === true);
      runtime.kernel.set.activeUI('dialog');
    });
    const unsubscribe = runtime.kernel.subscribe(render);
    return () => {
      unsubscribe();
      setEnabled(false, null);
    };
  }, [runtime]);

  // A page view on every client-side navigation (the first one is sent above).
  useEffect(() => {
    if (!gtag.current || lastPath.current === null || pathname === lastPath.current) return;
    const previous = `${window.location.origin}${lastPath.current}`;
    lastPath.current = pathname;
    sendPageView(gtag.current, window.location.origin, pathname, previous);
  }, [pathname]);

  const save = useCallback(
    async (input: 'all' | 'none' | { measurement: boolean }) => {
      if (!runtime) return;
      await runtime.kernel.commands.save(input, { uiSource: ui === 'dialog' ? 'dialog' : 'banner' });
      runtime.kernel.set.activeUI('none');
    },
    [runtime, ui],
  );

  const customise = () => {
    setDraft(measurement);
    runtime?.kernel.set.activeUI('dialog');
  };

  return (
    <>
      {ui === 'banner' && (
        <section className={styles.banner} aria-labelledby="dbk-consent-title">
          <h2 id="dbk-consent-title" className={styles.title}>
            Cookies
          </h2>
          <p className={styles.text}>
            We count visits to the app with Google Analytics. Without your OK it sets no cookies; with it, it
            keeps a random id so we can tell how many people come back. No names, characters or maps are sent.
          </p>
          <div className={styles.actions}>
            <Button size="sm" onClick={() => void save('all')}>
              Accept
            </Button>
            <Button size="sm" onClick={() => void save('none')}>
              Reject
            </Button>
            <Button size="sm" onClick={customise}>
              Customise
            </Button>
          </div>
        </section>
      )}
      <Dialog
        open={ui === 'dialog'}
        onOpenChange={(open) => {
          if (!open) runtime?.kernel.set.activeUI(hasChoice ? 'none' : 'banner');
        }}
      >
        <DialogContent
          title="Cookie settings"
          description="Choose what this app may keep in your browser. You can change it any time from Help, Cookie settings."
          width={460}
          footer={
            <>
              <Button size="sm" onClick={() => void save('none')}>
                Reject all
              </Button>
              <Button size="sm" onClick={() => void save('all')}>
                Accept all
              </Button>
              <Button size="sm" onClick={() => void save({ measurement: draft })}>
                Save choices
              </Button>
            </>
          }
        >
          <div className={styles.categories}>
            <div className={styles.category}>
              <div className={styles.categoryHead}>
                <span>Necessary</span>
                <span className={styles.always}>Always on</span>
              </div>
              <p className={styles.text}>
                Your sign-in and settings, and this choice (a <code>c15t</code> cookie and local storage
                entry).
              </p>
            </div>
            <div className={styles.category}>
              <Switch
                checked={draft}
                onCheckedChange={setDraft}
                label="Measurement"
                description="Google Analytics keeps a random id (_ga cookies) to count visits and returning people. Off, it still counts page views, without cookies."
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
