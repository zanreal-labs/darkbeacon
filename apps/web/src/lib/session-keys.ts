import type { MeDto } from '@darkbeacon/shared';

/** Query keys and helpers shared by client hooks and server components (no hooks in here). */
export const meKey = ['me'] as const;
export const providersKey = ['auth-providers'] as const;
export const mapsKey = ['maps'] as const;
export const mapKey = (slug: string) => ['map', slug] as const;

export function isInstanceAdmin(me: MeDto | null | undefined): boolean {
  return me?.account.instanceRole === 'owner' || me?.account.instanceRole === 'admin';
}
/** The viewer's own preferences on a map (viewport, bookmark template). */
export const mapPreferencesKey = (mapId: string) => ['map-preferences', mapId] as const;
