import type { Connection } from './map.js';

const HOUR = 60 * 60 * 1000;
/** "Less than 4 hours remaining": what EOL means in game. */
export const EOL_WINDOW_MS = 4 * HOUR;

/**
 * How long a wormhole lives when its type is unknown, by the classes it joins (the rule Wanderer
 * uses for new connections): a frigate hole 4.5 h, one touching C1-C4 16 h, one touching C5 or C6
 * 24 h, anything else (k-space, Thera, shattered, drifter holes) 24 h.
 */
export function defaultLifetimeHours(
  shipSize: Connection['shipSize'],
  sourceClass: number | null,
  targetClass: number | null,
): number {
  if (shipSize === 'small') return 4.5;
  const classes = [sourceClass, targetClass];
  if (classes.some((c) => c !== null && c >= 1 && c <= 4)) return 16;
  return 24;
}

export interface LifetimeInput {
  connection: Pick<Connection, 'type' | 'shipSize' | 'timeStatus' | 'eolAt' | 'updatedAt'>;
  /** When the map first saw the hole: the connection or one of its signatures, whichever is older. */
  firstSeenAt: number;
  /** Lifetime of its wormhole type (SDE), when the type is known. */
  typeLifetimeHours: number | null;
  sourceClass: number | null;
  targetClass: number | null;
}

export interface ConnectionLifetime {
  /** Hours the hole lives at most; null for stargates and bridges. */
  lifetimeHours: number | null;
  /** `type`: its wormhole type's lifetime; `class`: the default for the classes it joins. */
  lifetimeFrom: 'type' | 'class' | null;
  /** Latest moment it can still exist: its lifetime after it was first seen, 4 h after EOL was marked. */
  expiresBy: number | null;
  /** When it is in its last 4 hours by its lifetime alone (the moment it turns EOL in game). */
  eolBy: number | null;
}

/**
 * The one place a connection's lifetime is decided: the connections panel, the sidebar and the
 * sweeper (auto-EOL, auto-delete) all read it. Upper bounds: a hole was born at the latest when
 * the map first saw it.
 */
export function connectionLifetime(input: LifetimeInput): ConnectionLifetime {
  const c = input.connection;
  if (c.type !== 'wormhole') return { lifetimeHours: null, lifetimeFrom: null, expiresBy: null, eolBy: null };
  const lifetimeHours =
    input.typeLifetimeHours ?? defaultLifetimeHours(c.shipSize, input.sourceClass, input.targetClass);
  const lifetimeFrom = input.typeLifetimeHours !== null ? 'type' : 'class';
  const byLifetime = input.firstSeenAt + lifetimeHours * HOUR;
  const bounds = [byLifetime];
  if (c.timeStatus === 'eol') bounds.push((c.eolAt ?? c.updatedAt) + EOL_WINDOW_MS);
  return {
    lifetimeHours,
    lifetimeFrom,
    expiresBy: Math.min(...bounds),
    eolBy: byLifetime - EOL_WINDOW_MS,
  };
}

/**
 * Whether the sweeper must leave a connection alone. Locked connections are coming to mapping
 * (`locked`); until then nothing is locked.
 */
export function connectionLocked(connection: object): boolean {
  return (connection as { locked?: unknown }).locked === true;
}
