import type { JumpFuelHub } from '@darkbeacon/shared';

/** Isotope type ids (ESI `/universe/types/{id}`, checked 2026-11-09). */
export const ISOTOPE_TYPE_IDS = {
  helium: 16274,
  hydrogen: 17889,
  nitrogen: 17888,
  oxygen: 17887,
} as const;

export type Isotope = keyof typeof ISOTOPE_TYPE_IDS;

export interface FuelHub {
  station: number;
  stationName: string;
  region: number;
}

/** The trade hubs' main stations and their regions (ESI `/universe/stations/{id}`, 2026-11-09). */
export const FUEL_HUBS: Record<JumpFuelHub, FuelHub> = {
  jita: {
    station: 60003760,
    stationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
    region: 10000002,
  },
  amarr: { station: 60008494, stationName: 'Amarr VIII (Oris) - Emperor Family Academy', region: 10000043 },
  dodixie: {
    station: 60011866,
    stationName: 'Dodixie IX - Moon 20 - Federation Navy Assembly Plant',
    region: 10000032,
  },
  rens: { station: 60004588, stationName: 'Rens VI - Moon 8 - Brutor Tribe Treasury', region: 10000030 },
  hek: {
    station: 60005686,
    stationName: 'Hek VIII - Moon 12 - Boundless Creation Factory',
    region: 10000042,
  },
};
