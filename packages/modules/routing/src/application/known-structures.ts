import { requireAccount, type Actor, type Clock } from '@darkbeacon/core';
import type { KnownStructuresDto } from '@darkbeacon/shared';
import { EsiStructuresError } from '../domain/bridges.js';
import {
  mergeKnownStructures,
  STRUCTURE_SEARCH_SCOPE,
  UNIVERSE_STRUCTURES_SCOPE,
  type CorporationBook,
  type UpwellStructure,
} from '../domain/structures.js';
import type {
  AccessStructureSearch,
  CorporationNames,
  PilotDirectory,
  PublicStructureRepository,
  PublicStructureSource,
  RoutingUniverse,
  ScopedCharacters,
  StationCatalog,
} from '../ports/index.js';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** ESI's list of public structures is read about once a day (it caches it for an hour). */
export const PUBLIC_STRUCTURES_EVERY_MS = 23 * HOUR;
/** A public structure's details are read again when this old (names and owners change rarely). */
const DETAILS_FOR_MS = 7 * DAY;
/** Characters tried for a working access token before giving up on a refresh. */
const TOKEN_TRIES = 5;

export interface PublicStructureCatalogDeps {
  repo: PublicStructureRepository;
  source: PublicStructureSource;
  /** Linked characters whose grant reads structures. */
  characters: ScopedCharacters;
  tokens: Pick<PilotDirectory, 'accessToken'>;
  clock: Clock;
}

/**
 * The public Upwell structures of New Eden, shared by every account: ESI's
 * `GET /universe/structures` lists their ids (no login), and `GET /universe/structures/{id}`
 * (scope `esi-universe.read_structures.v1`) gives each one's name, system, type and owner. Any
 * linked character holding that scope can read a public structure, so the catalogue borrows the
 * first one that has a working token; without one nothing is read. Run about daily on one
 * process: details are read for new structures and ones a week old, and structures no longer
 * listed are dropped.
 */
export class PublicStructureCatalog {
  constructor(private readonly deps: PublicStructureCatalogDeps) {}

  /** Reads the catalogue when it is due (or `force`); null when it was not read. */
  async refresh(
    options: { force?: boolean } = {},
  ): Promise<{ listed: number; read: number; removed: number; failed: number } | null> {
    const { repo, source, clock } = this.deps;
    const now = clock.now();
    const listedAt = await repo.listedAt();
    if (!options.force && listedAt !== null && now - listedAt < PUBLIC_STRUCTURES_EVERY_MS) return null;
    const token = await this.token();
    if (!token) return null;
    const ids = await source.publicIds();
    const listed = new Set(ids);
    const known = await repo.readTimes();
    const gone = [...known.keys()].filter((id) => !listed.has(id));
    const stale = [...listed].filter((id) => {
      const at = known.get(id);
      return at === undefined || now - at > DETAILS_FOR_MS;
    });
    const reads = stale.length > 0 ? await source.read(stale, token) : { found: [], refused: [], failed: [] };
    await repo.save(reads.found, now);
    // A listed structure ESI refuses or no longer knows is not kept; it is asked for again tomorrow.
    await repo.remove([...gone, ...reads.refused]);
    await repo.markListed(now);
    return {
      listed: listed.size,
      read: reads.found.length,
      removed: gone.length + reads.refused.length,
      failed: reads.failed.length,
    };
  }

  private async token(): Promise<string | null> {
    const ids = await this.deps.characters.withScopes([UNIVERSE_STRUCTURES_SCOPE]);
    for (const id of ids.slice(0, TOKEN_TRIES)) {
      const token = await this.deps.tokens.accessToken(id).catch(() => null);
      if (token) return token;
    }
    return null;
  }
}

export interface KnownStructuresDeps {
  stations: Pick<StationCatalog, 'stationsIn'>;
  universe: Pick<RoutingUniverse, 'getSystem'>;
  publicStructures: Pick<PublicStructureRepository, 'inSystems'>;
  /** The structures the viewer's characters may use; without it they are never searched. */
  search?: AccessStructureSearch;
  pilots: Pick<PilotDirectory, 'charactersOf' | 'scopes'>;
  /** Owners' names and tickers; without it owners are shown by id. */
  owners?: CorporationNames;
}

/** ESI's search wants at least 3 characters (`minLength: 3`, https://esi.evetech.net/meta/openapi.json). */
const SEARCH_MIN = 3;
/** Character and system searches run at once (each reads up to eight structures at a time). */
const SEARCHES = 2;

/**
 * The stations and Upwell structures of some systems, as EVE says: NPC stations (static data),
 * public structures (the shared catalogue) and those the viewer's characters are on the access
 * list of (their structure search, never stored and seen by that account only). Ansiblex gates
 * are left out: the map's bridges show them.
 */
export class KnownStructures {
  constructor(private readonly deps: KnownStructuresDeps) {}

  async list(actor: Actor | null, solarSystemIds: readonly number[]): Promise<KnownStructuresDto> {
    const account = requireAccount(actor);
    const systems = [...new Set(solarSystemIds)];
    const stations = systems.flatMap((id) => this.deps.stations.stationsIn(id));
    const [publicRows, access] = await Promise.all([
      this.deps.publicStructures.inSystems(systems),
      this.access(account.id, systems),
    ]);
    const owners = await this.owners([...publicRows, ...access.rows]);
    return {
      structures: mergeKnownStructures({ stations, public: publicRows, access: access.rows, owners }),
      access: access.problem,
    };
  }

  /** What the account's characters with both structure scopes find in each system. */
  private async access(
    accountId: string,
    systems: readonly number[],
  ): Promise<{ rows: UpwellStructure[]; problem: KnownStructuresDto['access'] }> {
    const search = this.deps.search;
    if (!search) return { rows: [], problem: 'scope' };
    const characters = await this.deps.pilots.charactersOf(accountId);
    const able: number[] = [];
    for (const character of characters) {
      const scopes = await this.deps.pilots.scopes(character.id);
      if (scopes.includes(STRUCTURE_SEARCH_SCOPE) && scopes.includes(UNIVERSE_STRUCTURES_SCOPE))
        able.push(character.id);
    }
    if (able.length === 0) return { rows: [], problem: 'scope' };
    // Structures are named "<System> - <Name>"; a name shorter than the search allows is skipped.
    const named = systems.flatMap((id) => {
      const system = this.deps.universe.getSystem(id);
      return system && system.name.length >= SEARCH_MIN ? [{ id, name: system.name }] : [];
    });
    const queue = able.flatMap((characterId) => named.map((system) => ({ characterId, system })));
    const rows: UpwellStructure[] = [];
    const failed = { any: false };
    const run = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          rows.push(...(await search.structuresIn(next.characterId, next.system)));
        } catch (error) {
          // A grant that lost a scope meanwhile is simply not asked; anything else is EVE failing.
          if (error instanceof EsiStructuresError && error.reason === 'no-scope') continue;
          failed.any = true;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(SEARCHES, queue.length) }, run));
    return { rows, problem: failed.any ? 'unavailable' : null };
  }

  private async owners(rows: readonly UpwellStructure[]): Promise<CorporationBook> {
    const ids = [
      ...new Set(rows.flatMap((r) => (r.ownerCorporationId === null ? [] : [r.ownerCorporationId]))),
    ];
    if (ids.length === 0 || !this.deps.owners) return new Map();
    return this.deps.owners.corporations(ids).catch(() => new Map());
  }
}
