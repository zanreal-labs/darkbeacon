import { hasMapRole, parseStream, type DomainEvent } from '@darkbeacon/core';
import { isEventOfType } from '@darkbeacon/shared';
import { DEFAULT_AUTO_MAP_RULES, jumpAllowed, locationAllowed, type AutoMapRules } from '../domain/scopes.js';
import type {
  AutoMapTarget,
  BridgeLookup,
  MapAccess,
  TrackingRepository,
  UniverseLookup,
} from '../ports/index.js';

/**
 * Subscriber of `character.jumped`: adds the two systems and the connection between them
 * (a gate when a stargate links them, a bridge when a known Ansiblex does, a wormhole otherwise)
 * to the map the event belongs to, when the map's rules allow the jump (see `jumpAllowed`) and
 * the owner may still edit the map.
 *
 * Where a character is when its place first becomes known (tracking starts, or it is seen for the
 * first time) is added too when it is in scope, as Wanderer does: tracking a character on an
 * empty map starts the chain where the character is. Events are handled one at a time per map.
 */
export class AutoMapper {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly deps: {
      tracking: TrackingRepository;
      access: MapAccess;
      target: AutoMapTarget;
      universe: UniverseLookup;
      bridges?: BridgeLookup;
    },
  ) {}

  handle(event: DomainEvent): Promise<void> {
    const stream = parseStream(event.stream);
    if (stream?.kind !== 'map') return Promise.resolve();
    const mapId = stream.id;
    let work: (() => Promise<void>) | null = null;
    if (isEventOfType(event, 'character.jumped')) work = () => this.record(mapId, event.data);
    else if (isEventOfType(event, 'character.tracked') && event.data.solarSystemId !== null) {
      const { characterId, solarSystemId } = event.data;
      work = () => this.locate(mapId, characterId, solarSystemId);
    } else if (
      isEventOfType(event, 'character.moved') &&
      event.data.from === null &&
      event.data.to !== null
    ) {
      const { characterId, to } = event.data;
      work = () => this.locate(mapId, characterId, to);
    }
    if (!work) return Promise.resolve();
    const run = (this.queues.get(mapId) ?? Promise.resolve()).then(work);
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
    const entry = await tracking.findTracked(mapId, jump.characterId);
    if (!entry) return;
    const rules = await this.rulesOf(mapId);
    if (!rules) {
      await tracking.untrackMap(mapId);
      return;
    }
    // Map roles do not depend on the instance role, so the owner is checked as a plain account.
    const role = await access.roleOf({ kind: 'account', id: entry.accountId, instanceRole: 'user' }, mapId);
    if (!hasMapRole(role, 'member')) return;
    const gate = universe.gateLinked(jump.from, jump.to);
    const from = { id: jump.from, whClass: universe.getSystem(jump.from)?.whClass };
    const to = { id: jump.to, whClass: universe.getSystem(jump.to)?.whClass };
    // Abyssal pockets, excluded systems and jumps out of scope are skipped quietly.
    if (!jumpAllowed(rules, from, to, gate)) return;
    const bridge =
      !gate && rules.typeBridges && this.deps.bridges
        ? await this.deps.bridges.linked(mapId, jump.from, jump.to).catch(() => false)
        : false;
    await target.recordJump({
      mapId,
      from: jump.from,
      to: jump.to,
      type: gate ? 'gate' : bridge ? 'bridge' : 'wormhole',
      characterId: jump.characterId,
      shipTypeId: jump.shipTypeId,
      accountId: entry.accountId,
    });
  }

  /** Adds the system a character was found in, when the map's rules take it. */
  private async locate(mapId: string, characterId: number, solarSystemId: number): Promise<void> {
    const { tracking, access, target, universe } = this.deps;
    if (!target.placeSystem) return;
    // Every character is located when tracking starts: one row each, not the map's whole list.
    const entry = await tracking.findTracked(mapId, characterId);
    if (!entry) return;
    const rules = await this.rulesOf(mapId);
    if (!rules) return;
    const role = await access.roleOf({ kind: 'account', id: entry.accountId, instanceRole: 'user' }, mapId);
    if (!hasMapRole(role, 'member')) return;
    if (!locationAllowed(rules, { id: solarSystemId, whClass: universe.getSystem(solarSystemId)?.whClass }))
      return;
    await target.placeSystem({ mapId, solarSystemId, characterId, accountId: entry.accountId });
  }

  private async rulesOf(mapId: string): Promise<AutoMapRules | null> {
    const { target } = this.deps;
    if (target.rules) return target.rules(mapId);
    const scopes = await target.scopes(mapId);
    return scopes ? { ...DEFAULT_AUTO_MAP_RULES, scopes } : null;
  }
}
