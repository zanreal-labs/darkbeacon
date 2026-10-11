/**
 * Static universe data built from CCP's Static Data Export (SDE). The build script that
 * produces `universe.json` is added by the module that needs it; this file fixes the format.
 */
export interface SdeSolarSystem {
  id: number;
  name: string;
  regionId: number;
  constellationId: number;
  /** True security status, -1.0..1.0. */
  security: number;
  /** SDE wormhole class id (see UniverseSystemDto.whClass). */
  whClass: number | null;
  /** Stargate neighbours (solar system ids). */
  gates: number[];
}

export interface SdeRegion {
  id: number;
  name: string;
}

export interface SdeConstellation {
  id: number;
  name: string;
  regionId: number;
}

export interface UniverseData {
  /** SDE build the data was produced from. */
  source: string;
  regions: SdeRegion[];
  constellations: SdeConstellation[];
  systems: SdeSolarSystem[];
}
