import { hasMapRole, type Actor, type DomainEvent, type MapAccess } from '@darkbeacon/core';
import type { MapRepository } from '@darkbeacon/mapping';
import type { CharacterPresenceDto } from '@darkbeacon/shared';
import type { TrackingRepository } from '@darkbeacon/tracking';

const SETTING_TTL_MS = 5_000;
const ROLE_TTL_MS = 30_000;

/**
 * Wanderer's "show offline characters to managers only" (`offlineForManagersOnly` in the map's
 * settings): on such a map, viewers and members see only characters that are online, in the
 * list, the snapshot and the live events. For them a character going offline is untracked and
 * one coming online is tracked, so their view stays consistent; managers see everything.
 */
export class OfflineVisibility {
  private readonly settings = new Map<string, { on: boolean; at: number }>();
  private readonly roles = new Map<string, { manager: boolean; at: number }>();

  constructor(
    private readonly maps: MapRepository,
    private readonly access: MapAccess,
    private readonly tracking: TrackingRepository,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The list as `actor` may see it. */
  async filterList(
    actor: Actor | null,
    mapId: string,
    characters: CharacterPresenceDto[],
  ): Promise<CharacterPresenceDto[]> {
    if (!(await this.hides(actor, mapId))) return characters;
    return characters.filter((c) => c.online);
  }

  /** A `map:<id>` event as `actor` may see it (a realtime event filter). */
  async filterEvent(actor: Actor | null, mapId: string, event: DomainEvent): Promise<DomainEvent | null> {
    if (!event.type.startsWith('character.') || event.type === 'character.untracked') return event;
    if (!(await this.hides(actor, mapId))) return event;
    const data = event.data as { characterId: number; online?: boolean };
    switch (event.type) {
      case 'character.tracked':
        return data.online ? event : null;
      case 'character.online_changed': {
        if (!data.online)
          return { ...event, type: 'character.untracked', data: { characterId: data.characterId } };
        const presence = await this.tracking.getPresence(data.characterId);
        return presence ? { ...event, type: 'character.tracked', data: { ...presence, online: true } } : null;
      }
      default: {
        // Moves, jumps and ship changes of a character they cannot see are not for them.
        const presence = await this.tracking.getPresence(data.characterId);
        return presence?.online ? event : null;
      }
    }
  }

  /** The map's settings changed: read the option again (and every role on it). */
  forget(mapId: string): void {
    this.settings.delete(mapId);
    for (const key of [...this.roles.keys()]) if (key.endsWith(`:${mapId}`)) this.roles.delete(key);
  }

  /** True when the map hides offline characters and the actor is below manager there. */
  private async hides(actor: Actor | null, mapId: string): Promise<boolean> {
    if (!(await this.enabled(mapId))) return false;
    if (!actor) return true;
    const key = `${actor.kind}:${'id' in actor ? actor.id : ''}:${mapId}`;
    const cached = this.roles.get(key);
    if (cached && this.now() - cached.at < ROLE_TTL_MS) return !cached.manager;
    const manager = hasMapRole(await this.access.roleOf(actor, mapId), 'manager');
    this.roles.set(key, { manager, at: this.now() });
    if (this.roles.size > 10_000) this.roles.delete(this.roles.keys().next().value!);
    return !manager;
  }

  private async enabled(mapId: string): Promise<boolean> {
    const cached = this.settings.get(mapId);
    if (cached && this.now() - cached.at < SETTING_TTL_MS) return cached.on;
    const on = !!(await this.maps.findById(mapId))?.settings.offlineForManagersOnly;
    this.settings.set(mapId, { on, at: this.now() });
    if (this.settings.size > 10_000) this.settings.delete(this.settings.keys().next().value!);
    return on;
  }
}
