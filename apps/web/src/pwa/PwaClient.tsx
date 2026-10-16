'use client';

import { useEffect } from 'react';
import { useToast } from '../ui';
import {
  holdInstallPrompt,
  isStandalone,
  markInstalled,
  setInstallEnabled,
  type BeforeInstallPromptEvent,
} from './install';
import { opensInBrowser } from './links';
import { CACHE_PREFIX } from './sw-script';
import { activateWorker, watchForWaitingWorker } from './update';

const UPDATE_CHECK_MS = 30 * 60_000;

/**
 * What makes the app installable, added to the head once the server said the install is on: the
 * manifest link and Apple's home screen tags. Kept out of the prerendered HTML so `PWA=off` (read
 * at request time) leaves no manifest link behind.
 */
const HEAD: ReadonlyArray<{ tag: 'link' | 'meta'; attrs: Record<string, string> }> = [
  { tag: 'link', attrs: { rel: 'manifest', href: '/manifest.webmanifest' } },
  { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' } },
  { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' } },
  { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: 'Darkbeacon' } },
  // The page draws under the status bar (viewport-fit=cover); the top bar keeps clear of it.
  { tag: 'meta', attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' } },
];

function addHeadTags(): void {
  for (const { tag, attrs } of HEAD) {
    const key = tag === 'link' ? `link[rel="${attrs.rel}"]` : `meta[name="${attrs.name}"]`;
    if (document.head.querySelector(key)) continue;
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
    element.dataset.dbkPwa = '';
    document.head.append(element);
  }
}

/**
 * Off: forget any worker a browser installed before, and its caches (the server's `/sw.js` does
 * the same for browsers that check for an update before a page gets here).
 */
async function removeWorkers(): Promise<void> {
  const registrations = await navigator.serviceWorker?.getRegistrations?.().catch(() => []);
  for (const registration of registrations ?? []) {
    const script = registration.active ?? registration.waiting ?? registration.installing;
    if (script && new URL(script.scriptURL).pathname === '/sw.js') await registration.unregister();
  }
  if (typeof caches === 'undefined') return;
  for (const key of await caches.keys().catch(() => []))
    if (key.startsWith(CACHE_PREFIX)) await caches.delete(key).catch(() => false);
}

/**
 * The app install, once per page: the head tags, the service worker (production builds only), the
 * held install prompt for the help menu, the update toast and, in the installed app, links to
 * other sites opening in the browser. Rendered from the root layout with the server's `PWA` switch.
 */
export function PwaClient({ enabled }: { enabled: boolean }) {
  const toast = useToast();

  useEffect(() => {
    setInstallEnabled(enabled);
    if (!enabled) {
      for (const element of document.head.querySelectorAll('[data-dbk-pwa]')) element.remove();
      void removeWorkers();
      return;
    }
    addHeadTags();

    // Chromium's install offer: held for the help menu instead of its own banner.
    const offered = (event: Event) => {
      event.preventDefault();
      holdInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', offered);
    window.addEventListener('appinstalled', markInstalled);

    // In the app's own window, other sites open in the browser.
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || !isStandalone()) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const link = { href: anchor.href, target: anchor.target, download: anchor.hasAttribute('download') };
      if (!opensInBrowser(link, window.location.origin)) return;
      event.preventDefault();
      window.open(anchor.href, '_blank', 'noopener,noreferrer');
    };
    document.addEventListener('click', click);

    let stopWatching = () => {};
    let timer: number | undefined;
    let checkForUpdate = () => {};
    const visible = () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    };
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator && window.isSecureContext) {
      void navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .then((registration) => {
          stopWatching = watchForWaitingWorker(registration, (worker) =>
            toast({
              title: 'Update available',
              description: 'A new version of Darkbeacon is ready.',
              duration: Infinity,
              action: { label: 'Reload', onClick: () => activateWorker(worker) },
            }),
          );
          checkForUpdate = () => void registration.update().catch(() => {});
          timer = window.setInterval(checkForUpdate, UPDATE_CHECK_MS);
          document.addEventListener('visibilitychange', visible);
        })
        .catch(() => {
          // No worker (blocked, private mode): the app works the same without it.
        });
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', offered);
      window.removeEventListener('appinstalled', markInstalled);
      document.removeEventListener('click', click);
      document.removeEventListener('visibilitychange', visible);
      window.clearInterval(timer);
      stopWatching();
    };
  }, [enabled, toast]);

  return null;
}
