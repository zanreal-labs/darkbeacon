import type { Clock } from '@darkbeacon/core';
import {
  ANSIBLEX_TYPE_ID,
  EsiStructuresError,
  type AllianceDirectory,
  type CorporationAnsiblex,
  type CorporationStructures,
  type EveScoutClient,
  type EveScoutSignature,
  type Invasion,
  type InvasionLookup,
  type PingTargets,
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
        name?: string;
      }>;
      for (const row of rows) {
        if (row.type_id !== ANSIBLEX_TYPE_ID) continue;
        found.push({ structureId: row.structure_id, solarSystemId: row.system_id, name: row.name ?? null });
      }
    }
    return found;
  }
}

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

/** The alliance of an account's main character (else of its first character in one). */
export class AccountAlliances implements AllianceDirectory {
  constructor(
    private readonly deps: {
      mainCharacterOf(accountId: string): Promise<number | null>;
      charactersOf(accountId: string): Promise<Array<{ id: number; allianceId: number | null }>>;
    },
  ) {}

  async allianceOf(accountId: string): Promise<number | null> {
    const [main, characters] = await Promise.all([
      this.deps.mainCharacterOf(accountId),
      this.deps.charactersOf(accountId),
    ]);
    const pick = characters.find((c) => c.id === main) ?? characters.find((c) => c.allianceId !== null);
    return pick?.allianceId ?? null;
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

/** Pings are not built yet: no pinged system is a route target until they are. */
export const NO_PINGS: PingTargets = { pinged: async () => [] };
