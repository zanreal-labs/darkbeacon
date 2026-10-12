import type { JumpMetaDto, JumpShipDto, JumpUniverseDto } from '@darkbeacon/shared';

/** A small piece of known space for web tests: four systems on a line, one gate. */
export const UNIVERSE: JumpUniverseDto = {
  version: 'test1234',
  source: 'SDE build 1 (test)',
  regions: [
    { id: 10000002, name: 'The Forge' },
    { id: 10000043, name: 'Domain' },
  ],
  systems: {
    id: [30000142, 30002647, 30005196, 30005035],
    name: ['Jita', 'Ignoitton', 'Ahbazon', 'Ami'],
    region: [0, 0, 1, 1],
    security: [0.9459, 0.4388, 0.4205, 0.4382],
    x: [-13.64, -14.2, -18, -21],
    y: [6.42, 6, 5, 4.2],
    z: [12.42, 9, 2, -3],
    flags: [1, 0, 0, 1],
  },
  gates: [0, 1],
};

export const ARK: JumpShipDto = {
  typeId: 28850,
  name: 'Ark',
  hull: 'jump_freighter',
  rangeLy: 5,
  fuelPerLy: 8800,
  isotope: 'helium',
  fatigueMultiplier: 0.1,
  mass: 900_000_000,
  bridges: false,
  highSec: true,
  ansiblex: true,
  cyno: 'industrial',
};

export const META: JumpMetaDto = {
  version: UNIVERSE.version,
  source: UNIVERSE.source,
  ships: [
    ARK,
    {
      ...ARK,
      typeId: 11567,
      name: 'Avatar',
      hull: 'titan',
      rangeLy: 3,
      fuelPerLy: 3000,
      fatigueMultiplier: 1,
      bridges: true,
      highSec: false,
      ansiblex: false,
      cyno: 'regular',
    },
  ],
  rangeBonusPerLevel: 0.2,
  ansiblexRangeLy: 5,
};
