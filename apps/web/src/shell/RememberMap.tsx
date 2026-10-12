'use client';

import { useRememberMap } from '../lib/maps';

/** Tells the server this map was opened, for `/` and the map switcher. Renders nothing. */
export function RememberMap({ mapId }: { mapId: string }) {
  useRememberMap(mapId);
  return null;
}
