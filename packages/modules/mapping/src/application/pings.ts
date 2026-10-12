import { ConflictError, newId, NotFoundError, type Actor } from '@darkbeacon/core';
import type { CreatePingRequest, MapPingDto } from '@darkbeacon/shared';
import type { PingRepository } from '../ports/index.js';
import { MappingUseCases } from './base.js';

/**
 * Rally pings (Wanderer's rally points): a member calls everyone to one system of the map, with a
 * message. One per map: a new ping replaces the one before. Everyone on the map sees it (a card,
 * the system drawn as a rally, a route to it); Discord and webhooks hear `ping.created`; routes
 * take the system as a target. A pinged system cannot be removed until the ping is cancelled.
 */
export class PingUseCases extends MappingUseCases {
  async list(actor: Actor | null, mapId: string): Promise<MapPingDto[]> {
    await this.authorize(actor, mapId, 'viewer');
    return this.repository().list(mapId);
  }

  async create(actor: Actor | null, mapId: string, request: CreatePingRequest): Promise<MapPingDto> {
    const who = await this.authorizeEdit(actor, mapId);
    const author =
      who.kind === 'account' ? await this.ports.pingAuthors?.account(who.id).catch(() => null) : null;
    return this.write(who, mapId, async (events) => {
      await this.visibleSystem(mapId, request.solarSystemId);
      const pings = this.repository();
      for (const old of await pings.list(mapId)) {
        await pings.delete(mapId, old.id);
        events.add('ping.removed', { id: old.id }, old);
      }
      const ping: MapPingDto = {
        id: newId(),
        mapId,
        solarSystemId: request.solarSystemId,
        type: request.type,
        message: request.message,
        createdBy: who.id,
        createdByName: author?.name ?? null,
        characterId: author?.mainCharacterId ?? null,
        characterName: author?.mainCharacterName ?? null,
        createdAt: this.ports.clock.now(),
      };
      await pings.insert(ping);
      events.add('ping.created', ping);
      return ping;
    });
  }

  /** Cancels a ping (any member: a rally is over when the fleet says so). */
  async remove(actor: Actor | null, mapId: string, pingId: string): Promise<void> {
    const who = await this.authorizeEdit(actor, mapId);
    await this.write(who, mapId, async (events) => {
      const pings = this.repository();
      const ping = await pings.find(mapId, pingId);
      if (!ping) throw new NotFoundError('Ping');
      await pings.delete(mapId, pingId);
      events.add('ping.removed', { id: pingId }, ping);
    });
  }

  /** The systems with a ping on the map (route targets). */
  async pinged(mapId: string): Promise<number[]> {
    return (await this.repository().list(mapId)).map((p) => p.solarSystemId);
  }

  private repository() {
    if (!this.ports.pings) throw new ConflictError('Pings are not available');
    return this.ports.pings;
  }
}

/** Refuses to take a pinged system off the map (Wanderer: delete is blocked while pinged). */
export async function guardPinged(
  pings: Pick<PingRepository, 'list'> | undefined,
  mapId: string,
  solarSystemId: number,
): Promise<void> {
  if (!pings) return;
  if ((await pings.list(mapId)).some((p) => p.solarSystemId === solarSystemId))
    throw new ConflictError('A rally ping is on the system; cancel it first');
}
