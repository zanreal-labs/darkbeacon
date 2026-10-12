import type { Actor } from '@darkbeacon/core';
import type { ConnectionUseCases, MappingPorts, SystemUseCases } from '@darkbeacon/mapping';
import type { Position } from '@darkbeacon/shared';
import type { AutoMapTarget, RecordedJump } from '@darkbeacon/tracking';

/** Room a system node needs; a spot closer than this to another system is taken. */
const GAP = { x: 160, y: 70 };

/** Next free spot to the right of `anchor`, moving down until it covers no other system. */
export function spotNear(anchor: Position, taken: Position[]): Position {
  const spot = { x: anchor.x + 220, y: anchor.y };
  while (taken.some((p) => Math.abs(p.x - spot.x) < GAP.x && Math.abs(p.y - spot.y) < GAP.y)) spot.y += 80;
  return spot;
}

/** Tracking's AutoMapTarget over mapping's use cases, acting as the character's owner. */
export class MappingAutoMapTarget implements AutoMapTarget {
  constructor(
    private readonly ports: Pick<MappingPorts, 'maps' | 'systems'>,
    private readonly systems: SystemUseCases,
    private readonly connections: ConnectionUseCases,
  ) {}

  async scopes(mapId: string) {
    return (await this.ports.maps.findById(mapId))?.settings.scopes ?? null;
  }

  async recordJump(jump: RecordedJump): Promise<void> {
    const actor: Actor = { kind: 'account', id: jump.accountId, instanceRole: 'user' };
    await this.place(actor, jump.mapId, jump.from, jump.to);
    await this.place(actor, jump.mapId, jump.to, jump.from);
    // Idempotent: an existing connection comes back unchanged.
    await this.connections.add(actor, jump.mapId, { source: jump.from, target: jump.to, type: jump.type });
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
