import type { MassRange, MassStatus } from '@darkbeacon/shared';
import type { Connection, Passage } from './map.js';

/**
 * What each in-game mass status says is left, as a share of the hole's real total: "More than
 * 50 % remaining", "Less than 50 %", "Less than 10 %" (https://wiki.eveuniversity.org/Wormholes).
 */
export const MASS_BANDS: Record<MassStatus, { min: number; max: number }> = {
  fresh: { min: 0.5, max: 1 },
  reduced: { min: 0.1, max: 0.5 },
  critical: { min: 0, max: 0.1 },
};

/** A hole's real total mass is its type's nominal total ±10 % ("2,000,000,000 kg ± 10%"). */
export const TOTAL_MASS_VARIANCE = 0.1;

/** From when passages count towards the estimate: the mass status set, or the counter reset. */
export function countingSince(connection: Pick<Connection, 'massStatusAt'>): number | null {
  return connection.massStatusAt ?? null;
}

/** Passages the estimate counts. */
export function countedPassages<P extends Pick<Passage, 'occurredAt'>>(
  passages: readonly P[],
  since: number | null,
): P[] {
  return passages.filter((p) => since === null || p.occurredAt >= since);
}

export interface MassRangeInput {
  /** Nominal total of the wormhole type (kg). */
  total: number;
  status: MassStatus;
  /** Known mass of the counted passages. */
  passed: number;
  /** Counted passages whose ship (so mass) is unknown. */
  unknownPassages: number;
  /** Heaviest single jump; an unknown ship counts as anything up to it. */
  maxJumpMass: number | null;
  /** The hole regains its mass faster than anyone can use it (frigate holes). */
  regenerates: boolean;
}

export interface MassRangeResult extends MassRange {
  /** More passed than the status allowed even with the most generous total. */
  overdrawn: boolean;
}

/**
 * What is left of a hole, honestly: anywhere in the status band of a total that may be 10 % off,
 * minus what went through since the status was set. Unknown ships may have used up to the max
 * jump mass each, which only lowers the minimum.
 */
export function remainingMassRange(input: MassRangeInput): MassRangeResult {
  const band = MASS_BANDS[input.status];
  const low = input.total * (1 - TOTAL_MASS_VARIANCE);
  const high = input.total * (1 + TOTAL_MASS_VARIANCE);
  // Whole kilograms: the ±10 % would otherwise leave float dust in every number shown.
  const startMin = Math.round(band.min * low);
  const startMax = Math.round(band.max * high);
  if (input.regenerates) return { min: startMin, max: startMax, overdrawn: false };
  const unknown = input.unknownPassages * (input.maxJumpMass ?? 0);
  return {
    min: Math.max(0, startMin - input.passed - unknown),
    max: Math.max(0, startMax - input.passed),
    overdrawn: input.passed > 0 && input.passed >= startMax,
  };
}

/**
 * The mass statuses a hole with `remaining` left may show: each real total in ±10 % of `total`
 * puts the remaining share somewhere; every band that share range touches is possible.
 */
export function possibleStatuses(remaining: MassRange, total: number | null): MassStatus[] {
  if (total === null || total <= 0) return [];
  const minShare = remaining.min / (total * (1 + TOTAL_MASS_VARIANCE));
  const maxShare = remaining.max / (total * (1 - TOTAL_MASS_VARIANCE));
  const out: MassStatus[] = [];
  if (maxShare > MASS_BANDS.fresh.min) out.push('fresh');
  if (maxShare >= MASS_BANDS.reduced.min && minShare <= MASS_BANDS.reduced.max) out.push('reduced');
  if (minShare < MASS_BANDS.critical.max) out.push('critical');
  return out;
}

/** True when a single jump of `mass` is allowed through a hole whose max jump mass is `maxJumpMass`. */
export function fitsThrough(mass: number, maxJumpMass: number | null): boolean {
  return maxJumpMass === null || mass <= maxJumpMass;
}
