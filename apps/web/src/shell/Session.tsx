'use client';

import { useEffect } from 'react';
import { useRealtime } from '../lib/RealtimeProvider';
import { useTheme } from '../theme/ThemeProvider';

/** The account this tab last showed, kept across layouts (sign-in and sign-out leave the shell). */
let lastAccount: string | null = null;

/**
 * Runs when the signed-in account is known or changes: the socket authenticates with the session
 * cookie at connect time, so it reconnects; the account's own theme choice is read again.
 */
export function SessionSync({ accountId }: { accountId: string }) {
  const realtime = useRealtime();
  const { refresh: refreshTheme } = useTheme();
  useEffect(() => {
    if (lastAccount === accountId) return;
    const wasKnown = lastAccount !== null;
    lastAccount = accountId;
    refreshTheme();
    if (wasKnown) realtime.reconnect();
  }, [accountId, realtime, refreshTheme]);
  return null;
}

/**
 * The session cookie was there but the API no longer knows it (expired, signed out elsewhere):
 * drop it and start over, which signs in again in demo mode or shows the sign-in page.
 */
export function SignInRedirect() {
  useEffect(() => {
    const next = window.location.pathname + window.location.search;
    window.location.replace(`/login?${new URLSearchParams({ reset: '1', next })}`);
  }, []);
  return null;
}
