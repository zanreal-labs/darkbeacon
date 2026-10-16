'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings } from 'lucide-react';
import type { MapSummaryDto, MeDto } from '@darkbeacon/shared';
import { orderedMaps, useCachedData } from '../lib/maps';
import { MAP_SETTINGS_PARAM, mapSettingsSections } from '../lib/map-settings';
import { mapPermissions } from '../lib/roles';
import { mapsKey, meKey } from '../lib/session-keys';
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
 * The rail's settings button, at the bottom of the rail above Help, on every page so the rail never
 * shifts. On a map it opens that map's settings in a dialog over it (`?settings=`); elsewhere (the
 * jump planner, characters) it goes to the map opened last, with its settings open.
 */
export function MapSettingsRailButton() {
  const map = useManagedMap(usePathname());
  const settings = useMapSettings();
  const maps = useCachedData<MapSummaryDto[]>(mapsKey);
  const me = useCachedData<MeDto | null>(meKey);
  if (map) {
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
  const last = orderedMaps(maps ?? [], me?.account.recentMapIds ?? []).find(
    (m) => mapSettingsSections(mapPermissions(m.role)).length > 0,
  );
  const href = last
    ? `/m/${encodeURIComponent(last.slug)}?${MAP_SETTINGS_PARAM}=${mapSettingsSections(mapPermissions(last.role))[0]!}`
    : '/';
  return (
    <Tooltip content={last ? `Map settings: ${last.name}` : 'Map settings'} side="right">
      <Link href={href} className={styles.railLink} aria-label="Map settings">
        <Settings />
      </Link>
    </Tooltip>
  );
}
