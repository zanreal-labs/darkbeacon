'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { routes, type HealthDto } from '@darkbeacon/shared';
import { api } from '../lib/api';
import { useConnectionStatus } from '../lib/RealtimeProvider';
import { Button } from '../ui';
import styles from './StatusBits.module.css';

/** The build this page came from (next.config.ts); the server reports the one it serves now. */
const THIS_BUILD = process.env.DBK_BUILD_ID ?? null;
const CHECK_EVERY_MS = 5 * 60_000;
/** A page nobody touched for this long reloads itself once a new version is out (as Wanderer does). */
const IDLE_RELOAD_MS = 30 * 60_000;

/** True when the server serves a build other than this page's. */
export function isOutdated(
  health: Pick<HealthDto, 'build'> | null,
  own: string | null = THIS_BUILD,
): boolean {
  return !!own && !!health?.build && health.build !== own;
}

/**
 * Offers a reload once the server runs a newer build than this page: checked every few minutes,
 * whenever the realtime connection comes back (a restart) and when the tab gets focus. A page left
 * alone for half an hour reloads by itself.
 */
export function NewVersion() {
  const status = useConnectionStatus();
  const [outdated, setOutdated] = useState(false);
  const lastInput = useRef(0);

  useEffect(() => {
    if (!THIS_BUILD) return;
    let cancelled = false;
    const check = () =>
      api<HealthDto>(routes.health.path)
        .then((health) => !cancelled && isOutdated(health) && setOutdated(true))
        .catch(() => undefined);
    void check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    window.addEventListener('focus', check);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', check);
    };
    // A reconnect (the server restarted) is a good moment to look again.
  }, [status]);

  useEffect(() => {
    if (!outdated) return;
    const touched = () => (lastInput.current = Date.now());
    touched();
    const events = ['pointerdown', 'keydown', 'wheel'] as const;
    for (const e of events) window.addEventListener(e, touched, { passive: true });
    const timer = setInterval(() => {
      if (Date.now() - lastInput.current >= IDLE_RELOAD_MS) window.location.reload();
    }, 60_000);
    return () => {
      for (const e of events) window.removeEventListener(e, touched);
      clearInterval(timer);
    };
  }, [outdated]);

  if (!outdated) return null;
  return (
    <div className={styles.update} role="status">
      <Sparkles className={styles.updateIcon} aria-hidden />
      <div className={styles.updateText}>
        <strong>Darkbeacon was updated</strong>
        <span>Reload to get the new version.</span>
      </div>
      {/* A full page load, so the list comes from the new version. */}
      <Button size="sm" variant="ghost" asChild>
        <a href="/changelog">What&apos;s new</a>
      </Button>
      <Button size="sm" variant="primary" icon={<RefreshCw />} onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  );
}
