import type { Actor } from '@darkbeacon/core';
import type { LinkedMapDto } from '@darkbeacon/shared';
import { MappingUseCases } from './base.js';
import { MapUseCases } from './maps.js';

/**
 * The other maps a system is on, among those the viewer may open (Wanderer's "Also on <map>"):
 * each with its home, so a read-only preview can show the way in from there.
 */
export class LinkedMapQueries extends MappingUseCases {
  async elsewhere(actor: Actor | null, mapId: string, solarSystemId: number): Promise<LinkedMapDto[]> {
    await this.authorize(actor, mapId, 'viewer');
    const maps = await new MapUseCases(this.ports).list(actor);
    const out: LinkedMapDto[] = [];
    for (const map of maps) {
      // A merged map shows other maps' systems: the source maps are listed themselves.
      if (map.id === mapId || map.kind === 'composite') continue;
      const systems = await this.ports.systems.list(map.id);
      if (!systems.some((s) => s.visible && s.solarSystemId === solarSystemId)) continue;
      const home = systems.find((s) => s.visible && s.status === 'home');
      out.push({ mapId: map.id, slug: map.slug, name: map.name, home: home?.solarSystemId ?? null });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}
