import type { Clock } from '@darkbeacon/core';
import type { MappingPorts } from '@darkbeacon/mapping';
import type { ChainSource, PilotDirectory, WaypointGateway } from '@darkbeacon/routing';
import { ESI_COMPATIBILITY_DATE } from '../tracking/http-esi-gateway.js';

/** Routing's ChainSource over mapping's repositories. */
export class MappingChainSource implements ChainSource {
  constructor(private readonly ports: Pick<MappingPorts, 'maps' | 'systems' | 'connections' | 'overlay'>) {}

  async chain(mapId: string) {
    if (!(await this.ports.maps.findById(mapId))) return null;
    // A map that merges others routes over the merged chain.
    const merged = await this.ports.overlay?.view(mapId);
    if (merged) return { systems: merged.systems, connections: merged.connections };
    const [systems, connections] = await Promise.all([
      this.ports.systems.list(mapId),
      this.ports.connections.list(mapId),
    ]);
    return { systems, connections };
  }
}

/** What routing needs from identity's CharacterService. */
export interface CharacterLookup {
  character(characterId: number): Promise<{ name: string; accountId: string } | null>;
  scopes(characterId: number): Promise<string[]>;
  accessToken(characterId: number): Promise<string | null>;
}

const HOUR = 60 * 60 * 1000;

/**
 * PilotDirectory over identity and ESI's public `GET /characters/{character_id}` (security status,
 * cached for an hour).
 */
export class EsiPilotDirectory implements PilotDirectory {
  private readonly cache = new Map<number, { value: number | null; until: number }>();

  constructor(
    private readonly options: {
      characters: CharacterLookup;
      clock: Clock;
      userAgent: string;
      fetch?: typeof fetch;
      baseUrl?: string;
    },
  ) {}

  async ownerOf(characterId: number): Promise<string | null> {
    return (await this.options.characters.character(characterId))?.accountId ?? null;
  }

  scopes(characterId: number): Promise<string[]> {
    return this.options.characters.scopes(characterId);
  }

  accessToken(characterId: number): Promise<string | null> {
    return this.options.characters.accessToken(characterId);
  }

  async securityStatus(characterId: number): Promise<number | null> {
    const now = this.options.clock.now();
    const cached = this.cache.get(characterId);
    if (cached && cached.until > now) return cached.value;
    const response = await (this.options.fetch ?? fetch)(
      `${this.options.baseUrl ?? 'https://esi.evetech.net'}/characters/${characterId}`,
      {
        headers: {
          accept: 'application/json',
          'user-agent': this.options.userAgent,
          'x-compatibility-date': ESI_COMPATIBILITY_DATE,
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status === 404) {
      this.cache.set(characterId, { value: null, until: now + HOUR });
      return null;
    }
    if (!response.ok) throw new Error(`ESI answered ${response.status} for character ${characterId}`);
    const body = (await response.json()) as { security_status?: unknown };
    const value = typeof body.security_status === 'number' ? body.security_status : 0;
    this.cache.set(characterId, { value, until: now + HOUR });
    return value;
  }
}

/** ESI `POST /ui/autopilot/waypoint` (scope `esi-ui.write_waypoint.v1`, answers 204). */
export class HttpWaypointGateway implements WaypointGateway {
  constructor(private readonly options: { userAgent: string; fetch?: typeof fetch; baseUrl?: string }) {}

  async setWaypoint(
    accessToken: string,
    request: { destinationId: number; clearOtherWaypoints: boolean; addToBeginning: boolean },
  ): Promise<void> {
    const query = new URLSearchParams({
      add_to_beginning: String(request.addToBeginning),
      clear_other_waypoints: String(request.clearOtherWaypoints),
      destination_id: String(request.destinationId),
    });
    const response = await (this.options.fetch ?? fetch)(
      `${this.options.baseUrl ?? 'https://esi.evetech.net'}/ui/autopilot/waypoint?${query}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'user-agent': this.options.userAgent,
          'x-compatibility-date': ESI_COMPATIBILITY_DATE,
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error(`ESI refused the waypoint (${response.status})`);
  }
}
