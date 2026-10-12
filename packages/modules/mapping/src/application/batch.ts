import type { Actor } from '@darkbeacon/core';
import type {
  BatchDeleteRequest,
  BatchDeleteResultDto,
  BatchUpsertRequest,
  BatchUpsertResultDto,
} from '@darkbeacon/shared';
import type { Connection, MapSystem } from '../domain/map.js';
import { defined } from '../domain/rules.js';
import { MappingUseCases } from './base.js';
import { ConnectionUseCases } from './connections.js';
import { SystemUseCases } from './systems.js';

/**
 * Many systems and connections at once, as Wanderer's batch API: one transaction, all or nothing
 * (a locked system that would move fails the whole batch). Each change runs through the same use
 * cases as a single one, so it is checked, audited and published the same way.
 */
export class MapBatchUseCases extends MappingUseCases {
  async upsert(
    actor: Actor | null,
    mapId: string,
    request: BatchUpsertRequest,
  ): Promise<BatchUpsertResultDto> {
    const who = await this.authorizeEdit(actor, mapId);
    const systems = new SystemUseCases(this.ports);
    const connections = new ConnectionUseCases(this.ports);
    return this.ports.uow.transaction(async () => {
      const outSystems: MapSystem[] = [];
      for (const { solarSystemId, ...fields } of request.systems) {
        const placed = await systems.add(who, mapId, {
          solarSystemId,
          ...(fields.position ? { position: fields.position } : {}),
        });
        const patch = defined(fields);
        outSystems.push(
          Object.keys(patch).length > 0 ? await systems.update(who, mapId, solarSystemId, patch) : placed,
        );
      }
      const outConnections: Connection[] = [];
      for (const { source, target, ...fields } of request.connections) {
        const linked = await connections.add(who, mapId, {
          source,
          target,
          ...(fields.type ? { type: fields.type } : {}),
        });
        const patch = defined(fields);
        outConnections.push(
          Object.keys(patch).length > 0 ? await connections.update(who, mapId, linked.id, patch) : linked,
        );
      }
      return { systems: outSystems, connections: outConnections };
    });
  }

  async remove(
    actor: Actor | null,
    mapId: string,
    request: BatchDeleteRequest,
  ): Promise<BatchDeleteResultDto> {
    const who = await this.authorizeEdit(actor, mapId);
    const systems = new SystemUseCases(this.ports);
    const connections = new ConnectionUseCases(this.ports);
    return this.ports.uow.transaction(async () => {
      const result = { systems: 0, connections: 0, missing: 0 };
      for (const ref of request.connections) {
        const connection =
          typeof ref === 'string'
            ? await this.ports.connections.findById(mapId, ref)
            : await this.ports.connections.findBetween(mapId, ref.source, ref.target);
        if (!connection) {
          result.missing++;
          continue;
        }
        await connections.remove(who, mapId, connection.id);
        result.connections++;
      }
      for (const solarSystemId of request.systems) {
        if (!(await this.ports.systems.find(mapId, solarSystemId))?.visible) {
          result.missing++;
          continue;
        }
        await systems.remove(who, mapId, solarSystemId);
        result.systems++;
      }
      return result;
    });
  }
}
