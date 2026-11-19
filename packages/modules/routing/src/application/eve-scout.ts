import type { Clock } from '@darkbeacon/core';
import type { RouteHoleDto, ShipSize, TheraConnectionDto, TheraDto } from '@darkbeacon/shared';
import type { RoutedEdge } from '../domain/options.js';
import type { EveScoutClient, EveScoutSignature, RouteEdgeSource, RoutingUniverse } from '../ports/index.js';

/**
 * EVE-Scout answers from a cache that lives 300 s (`cache-control: public, max-age=300`), so
 * asking more often brings nothing new.
 */
export const EVE_SCOUT_POLL_MS = 5 * 60_000;

/** A hole is end of life under four hours. */
const EOL_HOURS = 4;

/**
 * A hole that EVE-Scout expects to close within the hour is not routed through: a pilot needs
 * time to fly to it, and its end is only an estimate (holes die early far more often than late).
 */
export const EXPIRY_MARGIN_MS = 60 * 60_000;

/**
 * Holes come and go by the minute: when EVE-Scout has not answered for this long, the copy in
 * memory is no longer trusted and routes stop going through Thera and Turnur until it answers.
 */
export const MAX_FEED_AGE_MS = 20 * 60_000;

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

  /** The holes worth routing through now: none when the copy is too old to trust. */
  connections(): TheraConnectionDto[] {
    const now = this.deps.clock.now();
    if (this.stale(now)) return [];
    return this.list.filter((c) => usable(c.expiresAt, now));
  }

  /**
   * Forgets the holes when EVE-Scout has not answered for too long; true when that dropped some
   * (routes through them must be found again). For the server to call when a refresh failed.
   */
  dropStale(): boolean {
    if (this.list.length === 0 || !this.stale(this.deps.clock.now())) return false;
    this.list = [];
    this.signatureKey = '';
    return true;
  }

  /** The hole between a hub and another system, as a route step shows it. */
  hole(a: number, b: number): RouteHoleDto | null {
    const c = this.connections().find(
      (c) => (c.hubSystemId === a && c.solarSystemId === b) || (c.hubSystemId === b && c.solarSystemId === a),
    );
    if (!c) return null;
    return {
      id: c.id,
      hubSystemId: c.hubSystemId,
      solarSystemId: c.solarSystemId,
      hubSignature: c.hubSignature,
      signature: c.signature,
      whType: c.whType,
      maxShipSize: c.maxShipSize,
      remainingHours: c.remainingHours,
      expiresAt: c.expiresAt,
      updatedAt: c.updatedAt ?? null,
    };
  }

  private stale(now: number): boolean {
    return this.fetchedAt === null || now - this.fetchedAt > MAX_FEED_AGE_MS;
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
    // A report still being written has not been checked; one about to close is not worth the trip.
    if (!hub || !system || s.completed === false || !usable(s.expiresAt, now)) return null;
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
      updatedAt: s.updatedAt ?? null,
    };
  }
}

/** Open for at least the margin still (holes without an end are taken as open). */
function usable(expiresAt: number | null, now: number): boolean {
  return expiresAt === null || expiresAt - now > EXPIRY_MARGIN_MS;
}
