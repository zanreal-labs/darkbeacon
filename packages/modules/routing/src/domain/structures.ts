import type { KnownStructureDto, KnownStructureSource } from '@darkbeacon/shared';
import { ANSIBLEX_TYPE_ID } from './bridges.js';

/** The ESI scope of `GET /characters/{character_id}/search` (every category, structures too). */
export const STRUCTURE_SEARCH_SCOPE = 'esi-search.search_structures.v1';
/** The ESI scope of `GET /universe/structures/{structure_id}`. */
export const UNIVERSE_STRUCTURES_SCOPE = 'esi-universe.read_structures.v1';

/**
 * Names of the Upwell structure types people dock at or anchor, by type id, as ESI's
 * `GET /universe/types/{type_id}` names them (checked 2026-11-15): citadels (group 1657 "Citadel"),
 * engineering complexes (1404), refineries (1406), the Pharolux and Tenebrex (2017, 2016) and the
 * Metenox Moon Drill (4744). A type not listed here keeps its id and no name.
 */
export const UPWELL_TYPE_NAMES: ReadonlyMap<number, string> = new Map([
  [35832, 'Astrahus'],
  [35833, 'Fortizar'],
  [35834, 'Keepstar'],
  [40340, 'Upwell Palatine Keepstar'],
  [47512, "'Moreau' Fortizar"],
  [47513, "'Draccous' Fortizar"],
  [47514, "'Horizon' Fortizar"],
  [47515, "'Marginis' Fortizar"],
  [47516, "'Prometheus' Fortizar"],
  [35825, 'Raitaru'],
  [35826, 'Azbel'],
  [35827, 'Sotiyo'],
  [35835, 'Athanor'],
  [35836, 'Tatara'],
  [35840, 'Pharolux Cyno Beacon'],
  [37534, 'Tenebrex Cyno Jammer'],
  [81826, 'Metenox Moon Drill'],
]);

/** An Upwell structure as ESI's `GET /universe/structures/{structure_id}` describes it. */
export interface UpwellStructure {
  structureId: number;
  name: string;
  solarSystemId: number;
  /** Optional in ESI's answer. */
  typeId: number | null;
  /** The owning corporation (`owner_id`). */
  ownerCorporationId: number | null;
}

/** An NPC station of a system (static data). */
export interface NpcStation {
  id: number;
  name: string;
  solarSystemId: number;
}

/** Names and tickers of corporations; a corporation left out is shown by its id only. */
export type CorporationBook = ReadonlyMap<number, { name: string | null; ticker: string | null }>;

/**
 * Ansiblex gates are left out of known structures: the map's bridges show them (and a gate is
 * no place to dock). Without a type, a name with "»" tells, as for the bridges.
 */
export function isAnsiblexStructure(structure: Pick<UpwellStructure, 'typeId' | 'name'>): boolean {
  if (structure.typeId !== null) return structure.typeId === ANSIBLEX_TYPE_ID;
  return structure.name.includes('»');
}

/**
 * One list of a system's stations and structures: NPC stations first, then structures by name.
 * A structure both public and on a character's access list is shown once, as public (everyone
 * sees it); Ansiblex gates are left out.
 */
export function mergeKnownStructures(input: {
  stations: readonly NpcStation[];
  public: readonly UpwellStructure[];
  access: readonly UpwellStructure[];
  owners: CorporationBook;
}): KnownStructureDto[] {
  const seen = new Set<number>();
  const result: KnownStructureDto[] = [];
  for (const station of [...input.stations].sort(byName)) {
    if (seen.has(station.id)) continue;
    seen.add(station.id);
    result.push({
      id: station.id,
      name: station.name,
      solarSystemId: station.solarSystemId,
      typeId: null,
      typeName: null,
      owner: null,
      source: 'npc',
    });
  }
  const structures: KnownStructureDto[] = [];
  const add = (rows: readonly UpwellStructure[], source: KnownStructureSource) => {
    for (const row of rows) {
      if (seen.has(row.structureId) || isAnsiblexStructure(row)) continue;
      seen.add(row.structureId);
      const owner = row.ownerCorporationId;
      const known = owner === null ? undefined : input.owners.get(owner);
      structures.push({
        id: row.structureId,
        name: row.name,
        solarSystemId: row.solarSystemId,
        typeId: row.typeId,
        typeName: row.typeId === null ? null : (UPWELL_TYPE_NAMES.get(row.typeId) ?? null),
        owner:
          owner === null ? null : { id: owner, name: known?.name ?? null, ticker: known?.ticker ?? null },
        source,
      });
    }
  };
  add(input.public, 'public');
  add(input.access, 'access');
  return [...result, ...structures.sort(byName)];
}

function byName(a: { name: string; id?: number }, b: { name: string; id?: number }): number {
  return a.name.localeCompare(b.name) || (a.id ?? 0) - (b.id ?? 0);
}
