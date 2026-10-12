'use client';

import { usePathname } from 'next/navigation';
import { Settings } from 'lucide-react';
import type { MapSummaryDto } from '@darkbeacon/shared';
import { useCachedData } from '../lib/maps';
import { mapSettingsSections } from '../lib/map-settings';
import { mapPermissions } from '../lib/roles';
import { mapsKey } from '../lib/session-keys';
import { useMapSettings } from '../lib/useMapSettings';
import { Tooltip } from '../ui';
import styles from './AppShell.module.css';

/**
 * The map open at `pathname` (`/m/<slug>`), when the visitor has a settings section there:
 * managers change the map, everyone has their own view of it and its history.
 */
export function useManagedMap(pathname: string): MapSummaryDto | null {
  // The shell sits outside the page's HydrationBoundary: read what the page put in the cache.
  const maps = useCachedData<MapSummaryDto[]>(mapsKey);
  const slug = /^\/m\/([^/]+)\/?$/.exec(pathname)?.[1];
  const map = slug ? maps?.find((m) => m.slug === decodeURIComponent(slug)) : undefined;
  return map && mapSettingsSections(mapPermissions(map.role)).length > 0 ? map : null;
}

/**
 * The rail's settings button, under the Map icon: on a map, it opens the map's settings in a
 * dialog over the map (`?settings=`), without leaving it.
 */
export function MapSettingsRailButton() {
  const map = useManagedMap(usePathname());
  const settings = useMapSettings();
  if (!map) return null;
  const open = settings.section !== null;
  return (
    <Tooltip content="Map settings" side="right">
      <button
        type="button"
        className={styles.railLink}
        aria-label="Map settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => settings.show(mapSettingsSections(mapPermissions(map.role))[0]!)}
      >
        <Settings />
      </button>
    </Tooltip>
  );
}
