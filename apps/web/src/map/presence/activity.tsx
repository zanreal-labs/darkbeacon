'use client';

import { createContext, useContext, useEffect } from 'react';
import type { PresenceActivity } from '@darkbeacon/shared';
import type { ActivityReporter } from '../../lib/presence-activity';

const NOBODY: ActivityReporter = { begin: () => {}, end: () => {}, pulse: () => {} };

/** Where widgets and dialogs on a map say what this tab is changing (nothing off a map). */
export const PresenceActivityContext = createContext<ActivityReporter>(NOBODY);

export function useActivity(): ActivityReporter {
  return useContext(PresenceActivityContext);
}

/** Holds `activity` while it is not null (an edit dialog is open); ends it on null or unmount. */
export function useHeldActivity(token: string, activity: PresenceActivity | null): void {
  const reporter = useActivity();
  const key = activity ? JSON.stringify(activity) : null;
  useEffect(() => {
    if (!key) return;
    reporter.begin(token, JSON.parse(key) as PresenceActivity);
    return () => reporter.end(token);
  }, [reporter, token, key]);
}
