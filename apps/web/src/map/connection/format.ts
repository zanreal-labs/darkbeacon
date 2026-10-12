import type { MassRange, MassStatus, PassageDto, RollReason } from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';

export { formatTonnes } from '../../lib/audit';

export const MASS_WORD: Record<MassStatus, string> = {
  fresh: 'Fresh',
  reduced: 'Reduced',
  critical: 'Critical',
};

/** What the game says for each status. */
export const MASS_MEANING: Record<MassStatus, string> = {
  fresh: 'over 50 % left',
  reduced: '10–50 % left',
  critical: 'under 10 % left',
};

/** The line's colours on the map, so the panel and the edge say the same. */
export const MASS_TOKEN: Record<MassStatus, string> = {
  fresh: cssVar('edge-mass-fresh'),
  reduced: cssVar('edge-mass-reduced'),
  critical: cssVar('edge-mass-critical'),
};

/** "3h 10m", "45m", "under a minute". */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** "12m ago", "3h ago", or the clock time for older ones. */
export function formatAgo(at: number, now: number): string {
  const ms = Math.max(0, now - at);
  if (ms < 60_000) return 'now';
  if (ms < 24 * 60 * 60_000) return `${formatDuration(ms)} ago`;
  return new Date(at).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Thousands of tonnes, short: "1 350 000 t" stays exact; ranges join with an en dash. */
export function formatRange(range: MassRange, tonnes: (kg: number) => string): string {
  if (Math.round(range.min / 1000) === Math.round(range.max / 1000)) return tonnes(range.max);
  return `${tonnes(range.min).replace(/ t$/, '')} – ${tonnes(range.max)}`;
}

export const MODE_WORD: Record<NonNullable<PassageDto['massMode']>, string> = {
  cold: 'Cold',
  hot: 'Hot',
  custom: 'Custom',
};

export const ROLL_HEADLINE: Record<RollReason, string> = {
  collapses: 'Closes on the last jump home',
  check: 'Check the hole on the way',
  strand: 'Someone may be stranded',
  noShips: 'Add the ships you have',
  tooHeavy: 'Every ship is too heavy for this hole',
  unknownType: 'The hole’s type is unknown',
  gone: 'By the estimate it should be gone',
  regenerates: 'Frigate holes regain their mass',
};

export const ROLL_TEXT: Record<RollReason, string> = {
  collapses:
    'Whatever the hole’s real mass, the plan closes it on a jump home and nobody ends up on the far side.',
  check:
    'The plan runs out of safe jumps before the hole must close. Look at it after the last step and set its mass status, then plan again.',
  strand:
    'Jumps out marked “may close” can close the hole with the ship on the far side. Look at the hole before each of them; setting its mass status narrows the plan.',
  noShips: 'Pick the ships of the rolling crew.',
  tooHeavy: 'None of them fits through even cold. Bring something lighter.',
  unknownType: 'Type the wormhole on a signature (or say what is left) to know its mass.',
  gone: 'More went through than the status allowed. Set the mass status as the hole shows it now.',
  regenerates: 'They cannot be rolled by mass; wait for them to die.',
};

export interface JumpsUntil {
  target: 'half' | 'critical' | 'collapse';
  /** Jumps of this ship at least and at most, null when it does not fit. */
  cold: { min: number; max: number } | null;
  hot: { min: number; max: number } | null;
}

/**
 * How many jumps of one ship take the hole to half, to critical and to collapse, cold and hot: the
 * fork's "jumps to state" table. A range because what is left is a range.
 */
export function jumpsUntil(
  remaining: MassRange,
  total: number | null,
  ship: { cold: number; hot: number },
  maxJumpMass: number | null,
): JumpsUntil[] {
  const targets: Array<[JumpsUntil['target'], number]> = [
    ['half', total === null ? 0 : 0.5 * total],
    ['critical', total === null ? 0 : 0.1 * total],
    ['collapse', 0],
  ];
  const count = (mass: number) => (target: number) => {
    if (mass <= 0 || (maxJumpMass !== null && mass > maxJumpMass)) return null;
    // Collapse needs the mass to reach what is left; the others to go under the mark.
    return {
      min: Math.ceil(Math.max(remaining.min - target, 0) / mass),
      max: Math.ceil(Math.max(remaining.max - target, 0) / mass),
    };
  };
  return (total === null ? targets.slice(2) : targets).map(([target, mark]) => ({
    target,
    cold: count(ship.cold)(mark),
    hot: count(ship.hot)(mark),
  }));
}
