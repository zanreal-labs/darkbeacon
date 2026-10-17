import type { Clock } from '@darkbeacon/core';
import {
  ANSIBLEX_TYPE_ID,
  EsiStructuresError,
  type AllianceDirectory,
  type AnsiblexStructure,
  type BridgePilot,
  type CharacterStructureSearch,
  type CorporationAlliances,
  type CorporationAnsiblex,
  type CorporationStructures,
  type EveScoutClient,
  type EveScoutSignature,
  type Invasion,
  type InvasionLookup,
  type SovereigntyLookup,
  type StationCatalog,
  type SystemDistances,
} from '@darkbeacon/routing';
import {
  loadInvasionData,
  loadKspaceData,
  loadStationData,
  type InvasionData,
  type KspaceData,
  type StationData,
} from '@darkbeacon/sde';
import type { StationDto } from '@darkbeacon/shared';
import { ESI_COMPATIBILITY_DATE } from '../tracking/http-esi-gateway.js';

const ESI = 'https://esi.evetech.net';

/** The ESI scope of `GET /corporations/{corporation_id}/structures`. */
export const CORPORATION_STRUCTURES_SCOPE = 'esi-corporations.read_structures.v1';

interface HttpOptions {
  userAgent: string;
  fetch?: typeof fetch;
  baseUrl?: string;
}

const headers = (userAgent: string, token?: string) => ({
  accept: 'application/json',
  'user-agent': userAgent,
  'x-compatibility-date': ESI_COMPATIBILITY_DATE,
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

/**
 * The Ansiblexes of a character's corporation: public `GET /characters/{id}` for the
 * corporation, then `GET /corporations/{id}/structures` page by page (scope
 * `esi-corporations.read_structures.v1`, role Station_Manager; ESI answers 403 without the role).
 */
export class EsiCorporationStructures implements CorporationStructures {
  constructor(
    private readonly options: HttpOptions & {
      scopes(characterId: number): Promise<string[]>;
      accessToken(characterId: number): Promise<string | null>;
    },
  ) {}

  async ansiblexes(characterId: number): Promise<CorporationAnsiblex[]> {
    if (!(await this.options.scopes(characterId)).includes(CORPORATION_STRUCTURES_SCOPE))
      throw new EsiStructuresError('no-token', 'The grant does not cover corporation structures');
    const token = await this.options.accessToken(characterId);
    if (!token) throw new EsiStructuresError('no-token', 'No working EVE login');
    const base = this.options.baseUrl ?? ESI;
    const get = (url: string, auth?: string) =>
      (this.options.fetch ?? fetch)(url, {
        headers: headers(this.options.userAgent, auth),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => {
        throw new EsiStructuresError('unavailable', 'EVE did not answer');
      });
    const character = await get(`${base}/characters/${characterId}`);
    if (!character.ok) throw new EsiStructuresError('unavailable', `ESI answered ${character.status}`);
    const { corporation_id: corporationId } = (await character.json()) as { corporation_id?: number };
    if (!corporationId) throw new EsiStructuresError('unavailable', 'That character has no corporation');
    const found: CorporationAnsiblex[] = [];
    for (let page = 1, pages = 1; page <= Math.min(pages, 10); page++) {
      const response = await get(`${base}/corporations/${corporationId}/structures?page=${page}`, token);
      if (response.status === 403 || response.status === 401)
        throw new EsiStructuresError('forbidden', 'EVE refused the structures');
      if (!response.ok) throw new EsiStructuresError('unavailable', `ESI answered ${response.status}`);
      pages = Number(response.headers.get('x-pages') ?? '1') || 1;
      const rows = (await response.json()) as Array<{
        structure_id: number;
        type_id: number;
        system_id: number;
        corporation_id?: number;
        name?: string;
      }>;
      for (const row of rows) {
        if (row.type_id !== ANSIBLEX_TYPE_ID) continue;
        found.push({
          structureId: row.structure_id,
          solarSystemId: row.system_id,
          name: row.name ?? null,
          ownerCorporationId: row.corporation_id ?? corporationId,
        });
      }
    }
    return found;
  }
}

/** The ESI scope of `GET /characters/{character_id}/search` (every category, structures too). */
export const STRUCTURE_SEARCH_SCOPE = 'esi-search.search_structures.v1';
/** The ESI scope of `GET /universe/structures/{structure_id}`. */
export const UNIVERSE_STRUCTURES_SCOPE = 'esi-universe.read_structures.v1';

/**
 * What the structure search asks for. Every Ansiblex is named "A » B - Name" by the game, and the
 * search wants at least 3 characters (`minLength: 3` in https://esi.evetech.net/meta/openapi.json),
 * so " » " finds them all and few other structures.
 */
export const ANSIBLEX_SEARCHES: readonly string[] = [' » '];

/** Structures read at once. */
const STRUCTURE_READS = 8;
/** Below this many errors left in ESI's window no request is sent until the window resets. */
const ERROR_FLOOR = 20;
/** ESI's error window is a minute; a reset further away than this is not waited for. */
const MAX_BACKOFF_MS = 65_000;
/** How long a character's bridges are kept (ESI caches the search and structures for an hour). */
const SEARCH_CACHE_MS = 15 * 60_000;

/**
 * The Ansiblexes a character may use, whoever owns them: ESI's character search for structures
 * named like an Ansiblex (scope `esi-search.search_structures.v1`), then
 * `GET /universe/structures/{id}` for each hit (scope `esi-universe.read_structures.v1`; ESI
 * answers 403 for a structure the character is not on the access list of, which is skipped),
 * keeping type 35841 with its owner (`owner_id`, a corporation). ESI's error limit is shared by the whole server: every 403 counts, so the
 * reads follow `X-ESI-Error-Limit-Remain` and wait for `X-ESI-Error-Limit-Reset` when few errors
 * are left (https://developers.eveonline.com/docs/services/esi/best-practices/). A character's
 * result is kept for a while.
 */
export class EsiAnsiblexSearch implements CharacterStructureSearch {
  private readonly cache = new Map<number, { until: number; gates: AnsiblexStructure[] }>();
  private errorsLeft = Number.POSITIVE_INFINITY;
  private resetAt = 0;

  constructor(
    private readonly options: HttpOptions & {
      clock: Clock;
      scopes(characterId: number): Promise<string[]>;
      accessToken(characterId: number): Promise<string | null>;
      sleep?(ms: number): Promise<void>;
    },
  ) {}

  async ansiblexes(characterId: number): Promise<AnsiblexStructure[]> {
    const now = this.options.clock.now();
    const cached = this.cache.get(characterId);
    if (cached && cached.until > now) return cached.gates;
    const scopes = await this.options.scopes(characterId);
    if (!scopes.includes(STRUCTURE_SEARCH_SCOPE) || !scopes.includes(UNIVERSE_STRUCTURES_SCOPE))
      throw new EsiStructuresError('no-scope', 'The grant does not cover the structures it may use');
    const token = await this.options.accessToken(characterId);
    if (!token) throw new EsiStructuresError('no-token', 'No working EVE login');
    const base = this.options.baseUrl ?? ESI;

    const ids = new Set<number>();
    for (const search of ANSIBLEX_SEARCHES) {
      const query = new URLSearchParams({ categories: 'structure', search });
      const response = await this.get(`${base}/characters/${characterId}/search?${query}`, token);
      if (!response) throw new EsiStructuresError('unavailable', 'EVE did not answer');
      if (response.status === 401 || response.status === 403)
        throw new EsiStructuresError('forbidden', 'EVE refused the structure search');
      if (!response.ok) throw new EsiStructuresError('unavailable', `ESI answered ${response.status}`);
      const body = (await response.json()) as { structure?: number[] };
      for (const id of body.structure ?? []) ids.add(id);
    }

    const queue = [...ids];
    const gates: AnsiblexStructure[] = [];
    let failed = 0;
    const read = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const response = await this.get(`${base}/universe/structures/${id}`, token);
        // Not on its access list (403), gone (404): not a bridge the character may use.
        if (response && [401, 403, 404].includes(response.status)) continue;
        if (!response?.ok) {
          failed++;
          continue;
        }
        const row = (await response.json()) as {
          name?: string;
          solar_system_id?: number;
          type_id?: number;
          owner_id?: number;
        };
        if (!row.solar_system_id || !isAnsiblex(row)) continue;
        gates.push({
          structureId: id,
          solarSystemId: row.solar_system_id,
          name: row.name ?? null,
          ownerCorporationId: row.owner_id ?? null,
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(STRUCTURE_READS, queue.length) }, read));
    if (failed > 0 && gates.length === 0)
      throw new EsiStructuresError('unavailable', `EVE did not answer for ${failed} structures`);
    gates.sort((a, b) => a.structureId - b.structureId);
    // A partial answer is used, but asked for again next time.
    if (failed === 0) this.cache.set(characterId, { until: now + SEARCH_CACHE_MS, gates });
    return gates;
  }

  /** One GET, after waiting out ESI's error window when few errors are left; null without an answer. */
  private async get(url: string, token: string): Promise<Response | null> {
    await this.backOff();
    const response = await (this.options.fetch ?? fetch)(url, {
      headers: headers(this.options.userAgent, token),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (!response) return null;
    const remain = Number(response.headers.get('x-esi-error-limit-remain'));
    const reset = Number(response.headers.get('x-esi-error-limit-reset'));
    if (response.headers.has('x-esi-error-limit-remain') && Number.isFinite(remain)) {
      this.errorsLeft = remain;
      this.resetAt = this.options.clock.now() + (Number.isFinite(reset) ? reset : 60) * 1000;
    }
    // ESI's own answer when the limit is spent: wait for the reset before anything else.
    if (response.status === 420) {
      this.errorsLeft = 0;
      if (this.resetAt <= this.options.clock.now()) this.resetAt = this.options.clock.now() + 60_000;
    }
    return response;
  }

  private async backOff(): Promise<void> {
    if (this.errorsLeft > ERROR_FLOOR) return;
    const wait = this.resetAt - this.options.clock.now();
    if (wait > MAX_BACKOFF_MS) throw new EsiStructuresError('unavailable', 'ESI error limit reached');
    if (wait > 0) await (this.options.sleep ?? sleep)(wait + 1000);
    this.errorsLeft = Number.POSITIVE_INFINITY;
  }
}

/** Corporations' alliances are kept this long (ESI caches `GET /corporations/{id}` for an hour). */
const AFFILIATION_CACHE_MS = 60 * 60_000;
/** Corporations read at once. */
const CORPORATION_READS = 8;

/**
 * Corporations' alliances from ESI's public `GET /corporations/{corporation_id}` (`alliance_id`,
 * absent for corporations in none), each asked once per call however many gates name it, kept for
 * an hour, and shared by concurrent calls. A corporation ESI does not answer for is left out.
 */
export class EsiCorporationAlliances implements CorporationAlliances {
  private readonly cache = new Map<number, { allianceId: number | null; until: number }>();
  private readonly reading = new Map<number, Promise<number | null | undefined>>();

  constructor(private readonly options: HttpOptions & { clock: Clock }) {}

  async alliancesOf(corporationIds: readonly number[]): Promise<Map<number, number | null>> {
    const result = new Map<number, number | null>();
    const now = this.options.clock.now();
    const queue: number[] = [];
    for (const id of new Set(corporationIds)) {
      const cached = this.cache.get(id);
      if (cached && cached.until > now) result.set(id, cached.allianceId);
      else queue.push(id);
    }
    const read = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const allianceId = await this.read(id);
        if (allianceId !== undefined) result.set(id, allianceId);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CORPORATION_READS, queue.length) }, read));
    return result;
  }

  /** One corporation's alliance (null: none); undefined when ESI did not answer. */
  private read(corporationId: number): Promise<number | null | undefined> {
    let running = this.reading.get(corporationId);
    if (!running) {
      running = this.fetchAlliance(corporationId).finally(() => this.reading.delete(corporationId));
      this.reading.set(corporationId, running);
    }
    return running;
  }

  private async fetchAlliance(corporationId: number): Promise<number | null | undefined> {
    const response = await (this.options.fetch ?? fetch)(
      `${this.options.baseUrl ?? ESI}/corporations/${corporationId}`,
      { headers: headers(this.options.userAgent), signal: AbortSignal.timeout(10_000) },
    ).catch(() => null);
    if (!response?.ok) return undefined;
    const body = (await response.json()) as { alliance_id?: number | null };
    const allianceId = typeof body.alliance_id === 'number' ? body.alliance_id : null;
    this.cache.set(corporationId, { allianceId, until: this.options.clock.now() + AFFILIATION_CACHE_MS });
    return allianceId;
  }
}

/** An Ansiblex by its type; without a type (ESI may leave it out), by its "A » B" name. */
function isAnsiblex(row: { name?: string; type_id?: number }): boolean {
  if (row.type_id !== undefined) return row.type_id === ANSIBLEX_TYPE_ID;
  return row.name?.includes('»') ?? false;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** EVE-Scout's public Thera and Turnur signatures (https://api.eve-scout.com/ui/). */
export class HttpEveScoutClient implements EveScoutClient {
  constructor(private readonly options: HttpOptions) {}

  async signatures(): Promise<EveScoutSignature[]> {
    const response = await (this.options.fetch ?? fetch)(
      `${this.options.baseUrl ?? 'https://api.eve-scout.com'}/v2/public/signatures`,
      {
        headers: { accept: 'application/json', 'user-agent': this.options.userAgent },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error(`EVE-Scout answered ${response.status}`);
    const rows = (await response.json()) as Array<Record<string, unknown>>;
    return rows.flatMap((row) => {
      const hub = Number(row.out_system_id);
      const far = Number(row.in_system_id);
      if (row.signature_type !== 'wormhole' || !Number.isInteger(hub) || !Number.isInteger(far)) return [];
      const text = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
      const expires = text(row.expires_at);
      return [
        {
          id: String(row.id),
          hubSystemId: hub,
          hubSignature: text(row.out_signature),
          solarSystemId: far,
          signature: text(row.in_signature),
          whType: text(row.wh_type),
          maxShipSize: text(row.max_ship_size),
          remainingHours: typeof row.remaining_hours === 'number' ? row.remaining_hours : null,
          expiresAt: expires ? Date.parse(expires) || null : null,
        },
      ];
    });
  }
}

/**
 * Sovereignty holders from ESI's public `GET /sovereignty/systems` (the claim of every system: an
 * alliance, a faction or none), read again every hour. It replaced `/sovereignty/map` and
 * `/sovereignty/structures`, which answer 404 from compatibility date 2026-05-19; ESI caches it
 * for 300 s.
 */
export class EsiSovereignty implements SovereigntyLookup {
  private holders = new Map<number, number>();
  private readAt = 0;

  constructor(private readonly options: HttpOptions & { clock: Clock }) {}

  holderOf(solarSystemId: number): number | null {
    return this.holders.get(solarSystemId) ?? null;
  }

  /** Reads the holders when the copy is older than an hour; true when it was read. */
  async refresh(maxAgeMs = 60 * 60_000): Promise<boolean> {
    if (this.options.clock.now() - this.readAt < maxAgeMs) return false;
    const response = await (this.options.fetch ?? fetch)(
      `${this.options.baseUrl ?? ESI}/sovereignty/systems`,
      { headers: headers(this.options.userAgent), signal: AbortSignal.timeout(20_000) },
    );
    if (!response.ok) throw new Error(`ESI answered ${response.status} for the sovereignty of systems`);
    const body = (await response.json()) as {
      solar_systems?: Array<{ solar_system_id: number; claim?: { alliance?: { alliance_id?: number } } }>;
    };
    this.holders = new Map(
      (body.solar_systems ?? []).flatMap((s) => {
        const alliance = s.claim?.alliance?.alliance_id;
        return alliance ? [[s.solar_system_id, alliance] as const] : [];
      }),
    );
    this.readAt = this.options.clock.now();
    return true;
  }
}

/** Light years between known-space systems, from the jump planner's map (`data/kspace.json`). */
export class KspaceDistances implements SystemDistances {
  private readonly at = new Map<number, number>();

  constructor(private readonly data: Pick<KspaceData, 'systems'>) {
    data.systems.id.forEach((id, i) => this.at.set(id, i));
  }

  static load(): KspaceDistances {
    try {
      return new KspaceDistances(loadKspaceData());
    } catch {
      return new KspaceDistances({
        systems: { id: [], name: [], region: [], security: [], x: [], y: [], z: [], flags: [] },
      });
    }
  }

  lightYears(a: number, b: number): number | null {
    const i = this.at.get(a);
    const j = this.at.get(b);
    if (i === undefined || j === undefined) return null;
    const { x, y, z } = this.data.systems;
    return Math.hypot(x[i]! - x[j]!, y[i]! - y[j]!, z[i]! - z[j]!);
  }
}

/**
 * The alliance of an account's pilot: the given character's when the account owns it, else the
 * main character's (else the first character's in one, else the first's). No pilot without
 * characters.
 */
export class AccountAlliances implements AllianceDirectory {
  constructor(
    private readonly deps: {
      mainCharacterOf(accountId: string): Promise<number | null>;
      charactersOf(accountId: string): Promise<Array<{ id: number; allianceId: number | null }>>;
    },
  ) {}

  async pilotOf(accountId: string, characterId?: number): Promise<BridgePilot> {
    const [main, characters] = await Promise.all([
      this.deps.mainCharacterOf(accountId),
      this.deps.charactersOf(accountId),
    ]);
    const pick =
      (characterId === undefined ? undefined : characters.find((c) => c.id === characterId)) ??
      characters.find((c) => c.id === main) ??
      characters.find((c) => c.allianceId !== null) ??
      characters[0];
    return pick ? { allianceId: pick.allianceId } : null;
  }
}

/** NPC stations from `@darkbeacon/sde` (`data/stations.json`). */
export class StaticStationCatalog implements StationCatalog {
  private readonly byId = new Map<number, StationDto>();
  private readonly bySystem = new Map<number, StationDto[]>();

  constructor(private readonly data: StationData) {
    const main = new Set(data.places.tradeHubs);
    for (const [id, solarSystemId, name] of data.stations) {
      const station = { id, solarSystemId, name, main: main.has(id) };
      this.byId.set(id, station);
      this.bySystem.set(solarSystemId, [...(this.bySystem.get(solarSystemId) ?? []), station]);
    }
  }

  static load(): StaticStationCatalog {
    try {
      return new StaticStationCatalog(loadStationData());
    } catch {
      return new StaticStationCatalog({
        source: 'none',
        stations: [],
        places: { securityOffice: [], blueLoot: [], redLoot: [], tradeHubs: [] },
      });
    }
  }

  stationsIn(solarSystemId: number): StationDto[] {
    return this.bySystem.get(solarSystemId) ?? [];
  }

  station(stationId: number): StationDto | null {
    return this.byId.get(stationId) ?? null;
  }

  places(kind: 'securityOffice' | 'blueLoot' | 'redLoot' | 'tradeHubs'): StationDto[] {
    return this.data.places[kind].flatMap((id) => this.byId.get(id) ?? []);
  }
}

/** Invasion outcomes from `@darkbeacon/sde` (`data/invasions.json`). */
export class StaticInvasionLookup implements InvasionLookup {
  private readonly byId = new Map<number, Invasion>();

  constructor(data: InvasionData) {
    for (const id of data.edencom) this.byId.set(id, 'edencom');
    for (const id of data.triglavian) this.byId.set(id, 'triglavian');
    for (const id of data.final) this.byId.set(id, 'final');
  }

  static load(): StaticInvasionLookup {
    try {
      return new StaticInvasionLookup(loadInvasionData());
    } catch {
      return new StaticInvasionLookup({ source: 'none', edencom: [], triglavian: [], final: [] });
    }
  }

  of(solarSystemId: number): Invasion | null {
    return this.byId.get(solarSystemId) ?? null;
  }
}
