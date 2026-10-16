import { noAuditScope, type Actor, type AuditScope } from '@darkbeacon/core';
import {
  nextPosition,
  type ConnectionUseCases,
  type MappingPorts,
  type MapSystem,
  type SystemUseCases,
} from '@darkbeacon/mapping';
import { SYSTEM_PLACEMENT, type Position } from '@darkbeacon/shared';
import {
  DEFAULT_AUTO_MAP_RULES,
  type AutoMapRules,
  type AutoMapTarget,
  type RecordedJump,
} from '@darkbeacon/tracking';

/** Room a system node needs; a spot closer than this to another system is taken. */
const GAP = { x: SYSTEM_PLACEMENT.x - 40, y: SYSTEM_PLACEMENT.y - 10 };

/** Next free spot to the right of `anchor`, moving down until it covers no other system. */
export function spotNear(anchor: Position, taken: Position[]): Position {
  const spot = { x: anchor.x + SYSTEM_PLACEMENT.x, y: anchor.y };
  while (taken.some((p) => Math.abs(p.x - spot.x) < GAP.x && Math.abs(p.y - spot.y) < GAP.y))
    spot.y += SYSTEM_PLACEMENT.y;
  return spot;
}

/**
 * Where auto-mapping puts `solarSystemId` when a character arrives there from `near` (null: found
 * there, no jump), as Wanderer's `maybe_add_system` does: next to `near` while that is on the map,
 * else at the next free spot. A system the map hid earlier is restored there too, locked or not,
 * not where it stood back then: maps imported from Wanderer keep every system ever visited,
 * hidden, at coordinates far from today's chain. Null when the map shows it already.
 */
export function arrivalSpot(
  all: readonly MapSystem[],
  solarSystemId: number,
  near: number | null,
): { position: Position } | null {
  if (all.some((s) => s.solarSystemId === solarSystemId && s.visible)) return null;
  const taken = all.filter((s) => s.visible).map((s) => s.position);
  const anchor = near === null ? undefined : all.find((s) => s.solarSystemId === near && s.visible);
  return { position: anchor ? spotNear(anchor.position, taken) : nextPosition(taken) };
}

/** Tracking's AutoMapTarget over mapping's use cases, acting as the character's owner. */
export class MappingAutoMapTarget implements AutoMapTarget {
  constructor(
    private readonly ports: Pick<MappingPorts, 'maps' | 'systems'>,
    private readonly systems: SystemUseCases,
    private readonly connections: ConnectionUseCases,
    private readonly audit: AuditScope = noAuditScope,
  ) {}

  async scopes(mapId: string) {
    return (await this.ports.maps.findById(mapId))?.settings.scopes ?? null;
  }

  async rules(mapId: string): Promise<AutoMapRules | null> {
    const settings = (await this.ports.maps.findById(mapId))?.settings;
    if (!settings) return null;
    const own = settings.autoMap ?? {};
    return {
      scopes: settings.scopes,
      excludedSystems: own.excludedSystems ?? DEFAULT_AUTO_MAP_RULES.excludedSystems,
      gateRule: own.gateRule ?? DEFAULT_AUTO_MAP_RULES.gateRule,
      typeBridges: own.typeBridges ?? DEFAULT_AUTO_MAP_RULES.typeBridges,
    };
  }

  async recordJump(jump: RecordedJump): Promise<void> {
    const actor: Actor = { kind: 'account', id: jump.accountId, instanceRole: 'user' };
    // Recorded as the owner, made by auto-mapping with the character that jumped.
    await this.audit.run(
      { channel: { kind: 'system', id: 'auto-mapping' }, characterId: jump.characterId },
      async () => {
        await this.place(actor, jump.mapId, jump.from, jump.to);
        await this.place(actor, jump.mapId, jump.to, jump.from);
        // Idempotent: an existing connection comes back unchanged.
        await this.connections.add(actor, jump.mapId, {
          source: jump.from,
          target: jump.to,
          type: jump.type,
        });
      },
    );
  }

  async placeSystem(input: { mapId: string; solarSystemId: number; characterId: number; accountId: string }) {
    const actor: Actor = { kind: 'account', id: input.accountId, instanceRole: 'user' };
    // Usually the system is on the map already: one row, not the whole chain.
    if ((await this.ports.systems.find(input.mapId, input.solarSystemId))?.visible) return;
    const spot = arrivalSpot(await this.ports.systems.list(input.mapId), input.solarSystemId, null);
    if (!spot) return;
    await this.audit.run(
      { channel: { kind: 'system', id: 'auto-mapping' }, characterId: input.characterId },
      () =>
        this.systems
          .add(actor, input.mapId, { solarSystemId: input.solarSystemId, ...spot })
          .then(() => undefined),
    );
  }

  /** Adds (or restores) `solarSystemId` next to `near` unless it is already on the map. */
  private async place(actor: Actor, mapId: string, solarSystemId: number, near: number): Promise<void> {
    // Most jumps are between systems already on the map: one row, not the whole chain.
    if ((await this.ports.systems.find(mapId, solarSystemId))?.visible) return;
    const spot = arrivalSpot(await this.ports.systems.list(mapId), solarSystemId, near);
    if (spot) await this.systems.add(actor, mapId, { solarSystemId, ...spot });
  }
}
