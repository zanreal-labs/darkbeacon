'use client';

import { useSearchParams } from 'next/navigation';
import { MAP_SETTINGS_PARAM } from './map-settings';

/**
 * Rewrites `?settings=` in place. The browser's own `history.replaceState` (which Next.js keeps
 * `useSearchParams` in step with) changes the address without a navigation: the page is not
 * fetched again and the map behind the dialog stays mounted and live.
 */
function writeSection(section: string | null) {
  const url = new URL(window.location.href);
  if (section === null) url.searchParams.delete(MAP_SETTINGS_PARAM);
  else url.searchParams.set(MAP_SETTINGS_PARAM, section);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

/**
 * The open section of the map settings dialog (`?settings=<section>`), or null while it is
 * closed; `show` opens it on a section (or switches to it), `hide` closes it.
 */
export function useMapSettings(): {
  section: string | null;
  show(section: string): void;
  hide(): void;
} {
  const section = useSearchParams().get(MAP_SETTINGS_PARAM);
  return { section, show: writeSection, hide: () => writeSection(null) };
}
