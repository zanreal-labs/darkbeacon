import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Facts about systems the SDE marks with a visual effect (`mapSolarSystems.visualEffect`):
 * `SHATTEREDWORMHOLE_OVERLAY` on the shattered systems (the J0 wormholes, the C13s and Turnur),
 * `TRIGLAVIAN_HOME` on Pochven, `THERA` and `CONCORD_HOME`. Only what the map shows is kept.
 */
export interface SystemFlagsData {
  /** SDE build the data was produced from. */
  source: string;
  /** Shattered systems, ascending. */
  shattered: number[];
}

export const SHATTERED_EFFECT = 'SHATTEREDWORMHOLE_OVERLAY';

export interface RawSystemEffect {
  _key: number;
  visualEffect?: string;
}

export function buildSystemFlags(source: string, systems: readonly RawSystemEffect[]): SystemFlagsData {
  return {
    source,
    shattered: systems
      .filter((s) => s.visualEffect === SHATTERED_EFFECT)
      .map((s) => s._key)
      .sort((a, b) => a - b),
  };
}

export function formatSystemFlags(data: SystemFlagsData): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

/** The committed dataset; `src/` and `dist/` both sit next to `data/`. */
export const SYSTEM_FLAGS_FILE = fileURLToPath(new URL('../data/system-flags.json', import.meta.url));

export function loadSystemFlags(file = SYSTEM_FLAGS_FILE): SystemFlagsData {
  return JSON.parse(readFileSync(file, 'utf8')) as SystemFlagsData;
}
