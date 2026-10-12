import type { Clock } from '@darkbeacon/core';
import type { ShipSize, TheraConnectionDto, TheraDto } from '@darkbeacon/shared';
import type { RoutedEdge } from '../domain/options.js';
import type { EveScoutClient, EveScoutSignature, RouteEdgeSource, RoutingUniverse } from '../ports/index.js';

/**
 * EVE-Scout answers from a cache that lives 300 s (`cache-control: public, max-age=300`), so
 * asking more often brings nothing new.
 */
export const EVE_SCOUT_POLL_MS = 5 * 60_000;

/** A hole is end of life under four hours. */
const EOL_HOURS = 4;

const SHIP_SIZES: Record<string, ShipSize> = {
  small: 'small',
  medium: 'medium',
  large: 'large',
  xlarge: 'xlarge',
  capital: 'capital',
};

/**
 * The public Thera and Turnur holes EVE-Scout lists, kept in memory and refreshed on a timer by
 * the server. Gives the router their edges (every map, unless its Thera toggle or the viewer's
 * options leave them out) and Routes By its Thera and Turnur destinations.
 */
export class TheraFeed implements RouteEdgeSource {
  private list: TheraConnectionDto[] = [];
  private fetchedAt: number | null = null;
  private signatureKey = '';

  constructor(private readonly deps: { client: EveScoutClient; universe: RoutingUniverse; clock: Clock }) {}

  /** Reads EVE-Scout again; true when the holes changed. Throws when it does not answer. */
  async refresh(): Promise<boolean> {
    const signatures = await this.deps.client.signatures();
    const now = this.deps.clock.now();
    this.fetchedAt = now;
    const list = signatures.flatMap((s) => this.toDto(s, now) ?? []);
    list.sort(
      (a, b) => a.hub.localeCompare(b.hub) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
    const key = JSON.stringify(
      list.map((c) => [c.id, c.solarSystemId, c.maxShipSize, (c.remainingHours ?? 99) < EOL_HOURS]),
    );
    this.list = list;
    if (key === this.signatureKey) return false;
    this.signatureKey = key;
    return true;
  }

  connections(): TheraConnectionDto[] {
    const now = this.deps.clock.now();
    return this.list.filter((c) => c.expiresAt === null || c.expiresAt > now);
  }

  snapshot(): TheraDto {
    return { connections: this.connections(), fetchedAt: this.fetchedAt };
  }

  async edges(): Promise<RoutedEdge[]> {
    return this.connections().map((c) => ({
      a: c.hubSystemId,
      b: c.solarSystemId,
      via: 'wormhole',
      connectionId: null,
      origin: 'eve-scout',
      state: {
        timeStatus: (c.remainingHours ?? EOL_HOURS) < EOL_HOURS ? 'eol' : 'normal',
        massStatus: 'fresh',
        shipSize: SHIP_SIZES[c.maxShipSize ?? ''] ?? 'large',
        dangerous: false,
        bubbled: 'none',
      },
    }));
  }

  private toDto(s: EveScoutSignature, now: number): TheraConnectionDto | null {
    const hub = s.hubSystemId === 31000005 ? 'thera' : s.hubSystemId === 30002086 ? 'turnur' : null;
    const system = this.deps.universe.getSystem(s.solarSystemId);
    if (!hub || !system || (s.expiresAt !== null && s.expiresAt <= now)) return null;
    return {
      id: s.id,
      hub,
      hubSystemId: s.hubSystemId,
      solarSystemId: system.id,
      name: system.name,
      security: system.security,
      regionName: system.regionName,
      whType: s.whType,
      maxShipSize: s.maxShipSize,
      hubSignature: s.hubSignature,
      signature: s.signature,
      remainingHours: s.remainingHours,
      expiresAt: s.expiresAt,
    };
  }
}
