import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  destinationOfClass,
  HULL_CLASS_LABEL,
  shipSizeForJumpMass,
  WORMHOLE_TYPES,
  type HullClass,
  type WormholeCatalogDto,
} from '@darkbeacon/shared';

/** The parts of `packages/sde/data/wormholes.json` the catalog is built from. */
interface WormholeFile {
  types: {
    code: string;
    targetClass: number | null;
    maxStableTimeMinutes: number | null;
    maxStableMass: number | null;
    maxJumpMass: number | null;
    massRegeneration: number | null;
  }[];
  hullClasses: { id: HullClass; maxMass: number }[];
}

/** The dataset, found from wherever the tests run (jsdom gives modules no file URL). */
function datasetFile(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const file = join(dir, 'packages/sde/data/wormholes.json');
    if (existsSync(file)) return file;
    if (dirname(dir) === dir) throw new Error('packages/sde/data/wormholes.json not found');
  }
}

/**
 * The wormhole catalog as `GET /api/universe/wormholes` answers it, built from the committed SDE
 * dataset the way the server's `StaticUniverseCatalog` builds it: real numbers for tests.
 */
export function wormholeCatalogFixture(): WormholeCatalogDto {
  const data = JSON.parse(readFileSync(datasetFile(), 'utf8')) as WormholeFile;
  const hulls = data.hullClasses.map((h) => ({ id: h.id, name: HULL_CLASS_LABEL[h.id], maxMass: h.maxMass }));
  const positive = (v: number | null) => (v !== null && v > 0 ? v : null);
  return {
    hullClasses: hulls,
    types: data.types.map((t) => {
      const maxJumpMass = positive(t.maxJumpMass);
      return {
        code: t.code,
        destination: destinationOfClass(t.targetClass) ?? WORMHOLE_TYPES[t.code] ?? null,
        targetClass: t.targetClass,
        lifetimeHours: t.maxStableTimeMinutes ? t.maxStableTimeMinutes / 60 : null,
        totalMass: positive(t.maxStableMass),
        maxJumpMass,
        massRegeneration: t.massRegeneration,
        fits: maxJumpMass === null ? [] : hulls.filter((h) => h.maxMass <= maxJumpMass).map((h) => h.id),
        shipSize: shipSizeForJumpMass(maxJumpMass),
      };
    }),
  };
}
