import type { MeDto } from '@darkbeacon/shared';

/** Query keys and helpers shared by client hooks and server components (no hooks in here). */
export const meKey = ['me'] as const;
export const providersKey = ['auth-providers'] as const;
export const instanceKey = ['instance'] as const;
export const mapsKey = ['maps'] as const;
export const sessionsKey = ['sessions'] as const;
export const mapKey = (slug: string) => ['map', slug] as const;

export function isInstanceAdmin(me: MeDto | null | undefined): boolean {
  return me?.account.instanceRole === 'owner' || me?.account.instanceRole === 'admin';
}
