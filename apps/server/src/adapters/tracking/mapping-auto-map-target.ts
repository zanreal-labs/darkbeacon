import { noAuditScope, type Actor, type AuditScope } from '@darkbeacon/core';
import type { ConnectionUseCases, MappingPorts, SystemUseCases } from '@darkbeacon/mapping';
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
    const all = await this.ports.systems.list(input.mapId);
    if (all.find((s) => s.solarSystemId === input.solarSystemId)?.visible) return;
    await this.audit.run(
      { channel: { kind: 'system', id: 'auto-mapping' }, characterId: input.characterId },
      () =>
        this.systems.add(actor, input.mapId, { solarSystemId: input.solarSystemId }).then(() => undefined),
    );
  }

  /** Adds (or restores) `solarSystemId` next to `near` unless it is already on the map. */
  private async place(actor: Actor, mapId: string, solarSystemId: number, near: number): Promise<void> {
    const all = await this.ports.systems.list(mapId);
    const existing = all.find((s) => s.solarSystemId === solarSystemId);
    if (existing?.visible) return;
    const anchor = all.find((s) => s.solarSystemId === near && s.visible);
    const visible = all.filter((s) => s.visible).map((s) => s.position);
    const position = !existing && anchor ? spotNear(anchor.position, visible) : undefined;
    await this.systems.add(actor, mapId, position ? { solarSystemId, position } : { solarSystemId });
  }
}
