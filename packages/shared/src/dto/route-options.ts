import { z } from 'zod';
import { EveId } from './common.js';

/** Comma separated query value -> distinct items (`?skip=eol,critical`). */
export const splitList = (value: string) => [
  ...new Set(
    value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  ),
];

/** `true`/`false` in a query string. */
const QueryFlag = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/**
 * Chain connections a route may skip: EOL, critical mass, frigate-only (ship size small),
 * cruiser-limited (ship size medium), marked dangerous, bubbled at either end.
 */
export const RouteSkip = z.enum(['eol', 'critical', 'frigate', 'medium', 'dangerous', 'bubbled']);
export type RouteSkip = z.infer<typeof RouteSkip>;

/**
 * Kinds of space a route may stay out of (it can still start or end there). `wormholes`: no
 * wormhole space and no wormhole connections, so k-space gates and bridges only. `pochven`: the
 * Triglavian region. `edencom` and `triglavian`: known-space systems the Triglavian invasion left
 * under EDENCOM or Triglavian control.
 */
export const RouteAvoidSpace = z.enum(['wormholes', 'pochven', 'edencom', 'triglavian']);
export type RouteAvoidSpace = z.infer<typeof RouteAvoidSpace>;

/** Route options shared by every routing query (all optional; absent means the default). */
export const RouteOptionsQuery = {
  skip: z.string().transform(splitList).pipe(z.array(RouteSkip).max(6)).optional(),
  /** Systems never to pass through. */
  avoid: z
    .string()
    .transform((value) => splitList(value).map(Number))
    .pipe(z.array(EveId).max(200))
    .optional(),
  avoidSpace: z.string().transform(splitList).pipe(z.array(RouteAvoidSpace).max(4)).optional(),
  /** Thera and Turnur holes from EVE-Scout (default on, when the map allows them). */
  thera: QueryFlag.optional(),
  /** The map's Ansiblex jump bridges (default on). */
  bridges: QueryFlag.optional(),
  /** Flying a capital: no jump bridge at all. */
  capital: QueryFlag.optional(),
};
