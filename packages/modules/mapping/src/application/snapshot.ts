import { NotFoundError, type Actor } from '@wormwright/core';
import type { MapSnapshot } from '@wormwright/shared';
import { MappingUseCases } from './base.js';

export type MappingSnapshot = Required<Pick<MapSnapshot, 'map' | 'systems' | 'connections' | 'signatures'>>;

/** The mapping part of a `map:<id>` snapshot. Hidden systems and their signatures are left out. */
export class MapSnapshotQuery extends MappingUseCases {
  async snapshot(actor: Actor | null, mapId: string): Promise<MappingSnapshot> {
    await this.authorize(actor, mapId, 'viewer');
    const map = await this.ports.maps.findById(mapId);
    if (!map) throw new NotFoundError('Map');
    const systems = (await this.ports.systems.list(mapId)).filter((s) => s.visible);
    const visible = new Set(systems.map((s) => s.solarSystemId));
    const connections = (await this.ports.connections.list(mapId)).filter(
      (c) => visible.has(c.source) && visible.has(c.target),
    );
    const signatures = (await this.ports.signatures.listForMap(mapId)).filter((s) =>
      visible.has(s.solarSystemId),
    );
    return { map, systems, connections, signatures };
  }
}
