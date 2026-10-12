'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import {
  routes,
  TELEMETRY_DOCS_URL,
  telemetryThemeId,
  ttiBucket,
  viewportBucket,
  type TelemetryClientDto,
} from '@darkbeacon/shared';
import { api } from '../lib/api';
import { configureTelemetry, track } from '../lib/telemetry';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui';
import styles from './Telemetry.module.css';

export const telemetryClientKey = ['telemetry-client'] as const;

/**
 * Turns the browser's usage reporting on or off as the server says, reports how the app was
 * loaded and themed once per page load, and shows admins the one-time notice about it.
 */
export function TelemetryRoot() {
  const client = useQuery({
    queryKey: telemetryClientKey,
    queryFn: () => api<TelemetryClientDto>(routes.telemetry.client.path),
    staleTime: Infinity,
    retry: false,
  });
  const { preference, theme } = useTheme();
  const pathname = usePathname();
  const loaded = useRef(false);
  const themed = useRef<string | null>(null);

  useEffect(() => {
    if (client.data) configureTelemetry(client.data.active);
    else if (client.isError) configureTelemetry(false);
  }, [client.data, client.isError]);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    track('app_loaded', {
      viewport: viewportBucket(window.innerWidth),
      tti: ttiBucket(performance.now()),
    });
  }, []);

  useEffect(() => {
    const key = `${preference}:${theme.colorScheme}`;
    if (themed.current === key) return;
    themed.current = key;
    track('theme_used', {
      theme: telemetryThemeId(preference),
      scheme: theme.colorScheme === 'dark' ? 'dark' : 'light',
    });
  }, [preference, theme.colorScheme]);

  // The admin page has the full card; the notice would only cover it.
  return client.data?.notice && !pathname?.startsWith('/admin') ? <TelemetryNotice /> : null;
}

/** Shown once to each admin: what is collected, where it is documented, how to turn it off. */
export function TelemetryNotice() {
  const [open, setOpen] = useState(true);
  const dismiss = useMutation({
    mutationFn: () => api<void>(routes.telemetry.dismissNotice.path, { method: 'POST' }),
  });
  if (!open) return null;
  const close = () => {
    setOpen(false);
    dismiss.mutate();
  };
  return (
    <section
      className={styles.notice}
      role="dialog"
      aria-modal="false"
      aria-labelledby="telemetry-notice-title"
    >
      <div className={styles.title} id="telemetry-notice-title">
        <BarChart3 aria-hidden />
        Anonymous usage statistics
      </div>
      <p className={styles.text}>
        This instance tells the Darkbeacon maintainers which features are used and how big it is, so they know
        what to improve. Only counts and fixed choices are sent: never names, characters, corporations,
        systems, maps, IP addresses or anything anyone types. Every payload is shown in the admin tab.
      </p>
      <div className={styles.actions}>
        <Button asChild variant="ghost">
          <a href={TELEMETRY_DOCS_URL} target="_blank" rel="noreferrer">
            What is sent
          </a>
        </Button>
        <Button asChild onClick={close}>
          <Link href="/admin?tab=instance#telemetry">Settings</Link>
        </Button>
        <Button variant="primary" onClick={close}>
          Got it
        </Button>
      </div>
    </section>
  );
}
