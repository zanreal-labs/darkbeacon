import type { MapScope } from '@darkbeacon/shared';

/** The map scope a system belongs to, from its SDE wormhole class; null when unknown. */
export function scopeOf(whClass: number | null | undefined): MapScope | null {
  switch (whClass) {
    case 7:
      return 'high';
    case 8:
      return 'low';
    case 9:
      return 'null';
    case 25:
      return 'pochven';
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
    case 12: // Thera
    case 13: // shattered frigate holes
    case 14:
    case 15:
    case 16:
    case 17:
    case 18: // Drifter systems
      return 'wormhole';
    default:
      return null;
  }
}

/**
 * Auto-mapping records a jump when either end is in one of the map's scopes, so leaving the
 * chain into known space still shows the exit, while travel inside excluded space is ignored.
 */
export function jumpInScope(
  scopes: readonly MapScope[],
  fromClass: number | null | undefined,
  toClass: number | null | undefined,
): boolean {
  return [scopeOf(fromClass), scopeOf(toClass)].some((s) => s !== null && scopes.includes(s));
}
