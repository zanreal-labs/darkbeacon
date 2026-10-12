'use client';

import { useEffect } from 'react';
import type { TelemetryWebEventProps } from '@darkbeacon/shared';
import { track } from './telemetry';

type PageView = TelemetryWebEventProps<'page_viewed'>;

/** Reports a page (or a tab of it) being looked at, once per visit of that page or tab. */
export function usePageView(page: PageView['page'], section?: PageView['section']): void {
  useEffect(() => {
    track('page_viewed', section ? { page, section } : { page });
  }, [page, section]);
}
