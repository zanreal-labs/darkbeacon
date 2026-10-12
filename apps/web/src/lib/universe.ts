import { useQueries } from '@tanstack/react-query';
import { buildPath, routes, type UniverseSystemDto } from '@darkbeacon/shared';
import type { TokenName } from '@darkbeacon/theme-sdk';
import { api } from './api';
import { universeKey } from './universe-keys';

export { universeKey } from './universe-keys';

/** Static data of the given systems, fetched once per system and kept for the session. */
export function useUniverseSystems(ids: readonly number[]): Map<number, UniverseSystemDto> {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: universeKey(id),
      queryFn: () => api<UniverseSystemDto>(buildPath(routes.universe.getSystem.path, { solarSystemId: id })),
      staleTime: Infinity,
      gcTime: Infinity,
      retry: false,
    })),
    combine: (results) => {
      const found = new Map<number, UniverseSystemDto>();
      for (const r of results) if (r.data) found.set(r.data.id, r.data);
      return found;
    },
  });
}

export interface SystemClass {
  /** Short label shown on the node, e.g. `C3`, `0.4`, `Thera`. */
  label: string;
  /** Token that colours the label. */
  token: TokenName;
}

/** Class label from the SDE wormhole class id, falling back to the security status. */
export function systemClass(info: Pick<UniverseSystemDto, 'whClass' | 'security'> | undefined): SystemClass {
  if (!info) return { label: '?', token: 'color-text-muted' };
  const c = info.whClass;
  if (c !== null && c >= 1 && c <= 6) return { label: `C${c}`, token: 'security-wormhole' };
  if (c === 12) return { label: 'Thera', token: 'security-special' };
  if (c === 13) return { label: 'C13', token: 'security-special' };
  if (c !== null && c >= 14 && c <= 18) return { label: 'Drifter', token: 'security-special' };
  if (c === 25) return { label: 'Pochven', token: 'security-special' };
  // k-space shows security to one decimal; the client rounds 0.0 < s < 0.05 up to 0.1.
  const shown = info.security > 0 && info.security < 0.05 ? 0.1 : Math.round(info.security * 10) / 10;
  const token: TokenName = shown >= 0.5 ? 'security-high' : shown > 0 ? 'security-low' : 'security-null';
  return { label: shown.toFixed(1), token };
}
