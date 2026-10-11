import { hasMapRole, parseStream, type DomainEvent } from '@wormwright/core';
import { isEventOfType } from '@wormwright/shared';
import { jumpInScope } from '../domain/scopes.js';
import type { AutoMapTarget, MapAccess, TrackingRepository, UniverseLookup } from '../ports/index.js';

/**
 * Subscriber of `character.jumped`: adds the two systems and the connection between them
 * (a gate when a stargate links them, a wormhole otherwise) to the map the event belongs to,
 * when the jump touches one of the map's scopes and the owner may still edit the map.
 * Jumps are handled one at a time per map.
 */
export class AutoMapper {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly deps: {
      tracking: TrackingRepository;
      access: MapAccess;
      target: AutoMapTarget;
      universe: UniverseLookup;
    },
  ) {}

  handle(event: DomainEvent): Promise<void> {
    const stream = parseStream(event.stream);
    if (!isEventOfType(event, 'character.jumped') || stream?.kind !== 'map') return Promise.resolve();
    const mapId = stream.id;
    const run = (this.queues.get(mapId) ?? Promise.resolve()).then(() => this.record(mapId, event.data));
    this.queues.set(
      mapId,
      run.catch(() => undefined),
    );
    return run;
  }

  private async record(
    mapId: string,
    jump: { characterId: number; from: number; to: number; shipTypeId: number | null },
  ): Promise<void> {
    const { tracking, access, target, universe } = this.deps;
    const entry = (await tracking.listTrackedOnMap(mapId)).find((t) => t.characterId === jump.characterId);
    if (!entry) return;
    const scopes = await target.scopes(mapId);
    if (!scopes) {
      await tracking.untrackMap(mapId);
      return;
    }
    // Map roles do not depend on the instance role, so the owner is checked as a plain account.
    const role = await access.roleOf({ kind: 'account', id: entry.accountId, instanceRole: 'user' }, mapId);
    if (!hasMapRole(role, 'member')) return;
    const fromClass = universe.getSystem(jump.from)?.whClass;
    const toClass = universe.getSystem(jump.to)?.whClass;
    if (!jumpInScope(scopes, fromClass, toClass)) return;
    await target.recordJump({
      mapId,
      from: jump.from,
      to: jump.to,
      type: universe.gateLinked(jump.from, jump.to) ? 'gate' : 'wormhole',
      characterId: jump.characterId,
      shipTypeId: jump.shipTypeId,
      accountId: entry.accountId,
    });
  }
}
