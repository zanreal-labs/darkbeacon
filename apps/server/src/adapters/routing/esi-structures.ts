import type { Clock } from '@darkbeacon/core';
import {
  EsiStructuresError,
  isAnsiblexStructure,
  STRUCTURE_SEARCH_SCOPE,
  UNIVERSE_STRUCTURES_SCOPE,
  type AccessStructureSearch,
  type PublicStructureSource,
  type StructureReads,
  type UpwellStructure,
} from '@darkbeacon/routing';
import { ESI_COMPATIBILITY_DATE } from '../tracking/http-esi-gateway.js';

const ESI = 'https://esi.evetech.net';

export interface EsiHttpOptions {
  userAgent: string;
  fetch?: typeof fetch;
  baseUrl?: string;
}

/** Headers of every ESI request: JSON, who asks, the compatibility date and the login when there is one. */
export const esiHeaders = (userAgent: string, token?: string) => ({
  accept: 'application/json',
  'user-agent': userAgent,
  'x-compatibility-date': ESI_COMPATIBILITY_DATE,
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

/** Below this many errors left in ESI's window no request is sent until the window resets. */
const ERROR_FLOOR = 20;
/** ESI's error window is a minute; a reset further away than this is not waited for. */
const MAX_BACKOFF_MS = 65_000;

/**
 * ESI's error limit, shared by every structure read of the server: every 403 and 404 counts
 * against it, so requests follow `X-ESI-Error-Limit-Remain` and wait for
 * `X-ESI-Error-Limit-Reset` when few errors are left, and stop for the window after a 420
 * (https://developers.eveonline.com/docs/services/esi/best-practices/).
 */
export class EsiErrorLimit {
  private errorsLeft = Number.POSITIVE_INFINITY;
  private resetAt = 0;

  constructor(private readonly options: { clock: Clock; sleep?(ms: number): Promise<void> }) {}

  /** Sends one request once the window allows it; null when it got no answer. */
  async send(request: () => Promise<Response>): Promise<Response | null> {
    await this.backOff();
    const response = await request().catch(() => null);
    if (!response) return null;
    const now = this.options.clock.now();
    const remain = Number(response.headers.get('x-esi-error-limit-remain'));
    const reset = Number(response.headers.get('x-esi-error-limit-reset'));
    if (response.headers.has('x-esi-error-limit-remain') && Number.isFinite(remain)) {
      this.errorsLeft = remain;
      this.resetAt = now + (Number.isFinite(reset) ? reset : 60) * 1000;
    }
    // ESI's own answer when the limit is spent: wait for the reset before anything else.
    if (response.status === 420) {
      this.errorsLeft = 0;
      if (this.resetAt <= now) this.resetAt = now + 60_000;
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

/** Structures read at once. */
const STRUCTURE_READS = 8;

/**
 * `GET /universe/structures/{structure_id}` for many structures, eight at a time (scope
 * `esi-universe.read_structures.v1`). ESI "returns Forbidden" for a structure the character is
 * not on the access list of, and 404 for one that is gone: both are refused. `name`,
 * `solar_system_id` and `owner_id` are required in ESI's answer, `type_id` is optional.
 */
export class EsiStructureReader {
  constructor(private readonly options: EsiHttpOptions & { limit: EsiErrorLimit }) {}

  /** The error window this reader follows (shared with the server's other structure reads). */
  get limit(): EsiErrorLimit {
    return this.options.limit;
  }

  /** One GET through the error limit; null without an answer. */
  get(url: string, token?: string): Promise<Response | null> {
    return this.options.limit.send(() =>
      (this.options.fetch ?? fetch)(url, {
        headers: esiHeaders(this.options.userAgent, token),
        signal: AbortSignal.timeout(15_000),
      }),
    );
  }

  get base(): string {
    return this.options.baseUrl ?? ESI;
  }

  async read(structureIds: readonly number[], token: string): Promise<StructureReads> {
    const queue = [...new Set(structureIds)];
    const result: StructureReads = { found: [], refused: [], failed: [] };
    const read = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        let response: Response | null;
        try {
          response = await this.get(`${this.base}/universe/structures/${id}`, token);
        } catch {
          // The error window is spent: what is left is not asked for now.
          result.failed.push(id, ...queue.splice(0));
          return;
        }
        if (response && [401, 403, 404].includes(response.status)) {
          result.refused.push(id);
          continue;
        }
        const row = response?.ok
          ? ((await response.json().catch(() => null)) as {
              name?: string;
              solar_system_id?: number;
              type_id?: number;
              owner_id?: number;
            } | null)
          : null;
        if (!row?.solar_system_id) {
          result.failed.push(id);
          continue;
        }
        result.found.push({
          structureId: id,
          name: row.name ?? '',
          solarSystemId: row.solar_system_id,
          typeId: row.type_id ?? null,
          ownerCorporationId: row.owner_id ?? null,
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(STRUCTURE_READS, queue.length) }, read));
    result.found.sort((a, b) => a.structureId - b.structureId);
    return result;
  }
}

/**
 * ESI's public structures: `GET /universe/structures` lists every structure anyone may dock at
 * ("security": none; its `filter` parameter is not used), and the reader gives their details.
 */
export class EsiPublicStructures implements PublicStructureSource {
  constructor(private readonly reader: EsiStructureReader) {}

  async publicIds(): Promise<number[]> {
    const response = await this.reader.get(`${this.reader.base}/universe/structures`);
    if (!response) throw new EsiStructuresError('unavailable', 'EVE did not answer');
    if (!response.ok) throw new EsiStructuresError('unavailable', `ESI answered ${response.status}`);
    const ids = (await response.json()) as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is number => Number.isSafeInteger(id)) : [];
  }

  read(structureIds: readonly number[], accessToken: string): Promise<StructureReads> {
    return this.reader.read(structureIds, accessToken);
  }
}

/** How long a character's structures in a system are kept (ESI caches both reads for an hour). */
const ACCESS_CACHE_MS = 15 * 60_000;

/**
 * The structures in a system a character may use: `GET /characters/{id}/search` for the system's
 * name in category `structure` (scope `esi-search.search_structures.v1`; the game names every
 * structure "<System> - <Name>"), then the details of each hit, keeping those standing in that
 * system (a name may mention another system) and leaving out Ansiblex gates. Kept 15 minutes per
 * character and system; a partial answer is used but asked for again next time.
 */
export class EsiAccessStructureSearch implements AccessStructureSearch {
  private readonly cache = new Map<string, { until: number; structures: UpwellStructure[] }>();

  constructor(
    private readonly options: {
      reader: EsiStructureReader;
      clock: Clock;
      scopes(characterId: number): Promise<string[]>;
      accessToken(characterId: number): Promise<string | null>;
    },
  ) {}

  async structuresIn(characterId: number, system: { id: number; name: string }): Promise<UpwellStructure[]> {
    const key = `${characterId}:${system.id}`;
    const now = this.options.clock.now();
    const cached = this.cache.get(key);
    if (cached && cached.until > now) return cached.structures;
    const scopes = await this.options.scopes(characterId);
    if (!scopes.includes(STRUCTURE_SEARCH_SCOPE) || !scopes.includes(UNIVERSE_STRUCTURES_SCOPE))
      throw new EsiStructuresError('no-scope', 'The grant does not cover the structures it may use');
    const token = await this.options.accessToken(characterId);
    if (!token) throw new EsiStructuresError('no-token', 'No working EVE login');
    const { reader } = this.options;
    const query = new URLSearchParams({ categories: 'structure', search: system.name });
    const response = await reader.get(`${reader.base}/characters/${characterId}/search?${query}`, token);
    if (!response) throw new EsiStructuresError('unavailable', 'EVE did not answer');
    if (response.status === 401 || response.status === 403)
      throw new EsiStructuresError('forbidden', 'EVE refused the structure search');
    if (!response.ok) throw new EsiStructuresError('unavailable', `ESI answered ${response.status}`);
    const body = (await response.json()) as { structure?: number[] };
    const reads = await reader.read(body.structure ?? [], token);
    const structures = reads.found.filter((s) => s.solarSystemId === system.id && !isAnsiblexStructure(s));
    if (reads.failed.length > 0 && reads.found.length === 0)
      throw new EsiStructuresError('unavailable', `EVE did not answer for ${reads.failed.length} structures`);
    this.prune(now);
    if (reads.failed.length === 0) this.cache.set(key, { until: now + ACCESS_CACHE_MS, structures });
    return structures;
  }

  private prune(now: number): void {
    if (this.cache.size < 1_000) return;
    for (const [key, entry] of this.cache) if (entry.until <= now) this.cache.delete(key);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
