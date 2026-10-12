import type {
  HullClassDto,
  MassModifiersDto,
  ShipTypeDto,
  UniverseSystemDto,
  WormholeTypeDto,
} from '@darkbeacon/shared';

export type UniverseSystem = UniverseSystemDto;

/** Static game data (built from the SDE), loaded in memory. Synchronous on purpose. */
export interface UniverseCatalog {
  getSystem(solarSystemId: number): UniverseSystem | null;
  /** Case-insensitive prefix match first, then substring; at most `limit` results. */
  searchSystems(query: string, limit: number): UniverseSystem[];
  /** True when a stargate links the two systems. */
  gateLinked(a: number, b: number): boolean;
  /** A wormhole type by code (case-insensitive), K162 included; null when unknown. */
  wormholeType(code: string): WormholeTypeDto | null;
  /** Every wormhole type, by code. */
  wormholeTypes(): WormholeTypeDto[];
  /** The hull classes `WormholeTypeDto.fits` refers to, lightest first. */
  hullClasses(): HullClassDto[];
  /** Hull mass (kg) of a ship type, null when the type is not a known ship. */
  shipMass(shipTypeId: number): number | null;
  /** A published ship with what changes its jump mass; null when not a known published ship. */
  ship(shipTypeId: number): ShipTypeDto | null;
  /** Published ships by name: prefix matches first, then substrings; at most `limit`. */
  searchShips(query: string, limit: number): ShipTypeDto[];
  /** What prop modules, Higgs Anchors and the mass entangler do to a ship's mass (SDE dogma). */
  massModifiers(): MassModifiersDto;
}
