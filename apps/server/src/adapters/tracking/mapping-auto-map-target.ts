import { noAuditScope, type Actor, type AuditScope } from '@darkbeacon/core';
import { type ConnectionUseCases, type MappingPorts, type SystemUseCases } from '@darkbeacon/mapping';
import {
  DEFAULT_AUTO_MAP_RULES,
  type AutoMapRules,
  type AutoMapTarget,
  type RecordedJump,
} from '@darkbeacon/tracking';

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
    // Found there without a jump: next to home (or the last system placed), by the map's rule.
    await this.audit.run(
      { channel: { kind: 'system', id: 'auto-mapping' }, characterId: input.characterId },
      () =>
        this.systems.add(actor, input.mapId, { solarSystemId: input.solarSystemId }).then(() => undefined),
    );
  }

  /**
   * Adds (or restores) `solarSystemId` next to `near`, the system the jump came from, unless it is
   * already on the map, by the map's placement rule (`placeSystem`), as Wanderer's
   * `maybe_add_system` does. A system the map hid earlier goes back to its old spot only when that
   * is free and still next to `near`: maps imported from Wanderer keep every system ever visited,
   * hidden, at coordinates far from today's chain.
   */
  private async place(actor: Actor, mapId: string, solarSystemId: number, near: number): Promise<void> {
    // Most jumps are between systems already on the map: one row, not the whole chain.
    if ((await this.ports.systems.find(mapId, solarSystemId))?.visible) return;
    await this.systems.add(actor, mapId, { solarSystemId, near });
  }
}
