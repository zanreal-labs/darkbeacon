'use client';

/** Set in the tab that asked for the update, so only that tab reloads when the new worker takes over. */
let reloading = false;

/** Lets a waiting worker take over, then reloads this tab with it. */
export function activateWorker(worker: ServiceWorker): void {
  reloading = true;
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
    once: true,
  });
  worker.postMessage({ type: 'SKIP_WAITING' });
  // The worker should take over at once; reload anyway if it does not.
  window.setTimeout(() => window.location.reload(), 4_000);
}

/** Reloads to a new version: through the waiting worker when there is one, so both are new. */
export async function reloadForUpdate(): Promise<void> {
  if (reloading) return;
  const registration = await navigator.serviceWorker?.getRegistration?.().catch(() => undefined);
  if (registration?.waiting && navigator.serviceWorker.controller) activateWorker(registration.waiting);
  else window.location.reload();
}

/**
 * Calls `onWaiting` whenever a new worker has installed and waits to replace the one controlling
 * this page (not for the very first install, which takes over on its own).
 */
export function watchForWaitingWorker(
  registration: ServiceWorkerRegistration,
  onWaiting: (worker: ServiceWorker) => void,
): () => void {
  const controlled = () => !!navigator.serviceWorker.controller;
  if (registration.waiting && controlled()) onWaiting(registration.waiting);
  const found = () => {
    const worker = registration.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && controlled()) onWaiting(worker);
    });
  };
  registration.addEventListener('updatefound', found);
  return () => registration.removeEventListener('updatefound', found);
}
