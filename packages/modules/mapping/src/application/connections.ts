import { ConflictError, NotFoundError, ValidationError, newId, type Actor } from '@darkbeacon/core';
import type { AddConnectionRequest, UpdateConnectionRequest } from '@darkbeacon/shared';
import type { Connection } from '../domain/map.js';
import { changes, defaultShipSize, defined } from '../domain/rules.js';
import { MappingUseCases } from './base.js';
import { removeConnection } from './systems.js';

export class ConnectionUseCases extends MappingUseCases {
  /**
   * Connects two visible systems. Returns the existing connection when they are already linked
   * (in either direction), so auto-mapping can call it blindly.
   */
  async add(actor: Actor | null, mapId: string, request: AddConnectionRequest): Promise<Connection> {
    const who = await this.authorize(actor, mapId, 'member');
    if (request.source === request.target) throw new ValidationError('A system cannot connect to itself');
    return this.write(who, mapId, async (events) => {
      await this.visibleSystem(mapId, request.source);
      await this.visibleSystem(mapId, request.target);
      const existing = await this.ports.connections.findBetween(mapId, request.source, request.target);
      if (existing) return existing;

      const { universe } = this.ports;
      const type =
        request.type ?? (universe.gateLinked(request.source, request.target) ? 'gate' : 'wormhole');
      const now = this.ports.clock.now();
      const connection: Connection = {
        id: newId(),
        mapId,
        source: request.source,
        target: request.target,
        type,
        timeStatus: 'normal',
        massStatus: 'fresh',
        shipSize: defaultShipSize(
          type,
          universe.getSystem(request.source),
          universe.getSystem(request.target),
        ),
        massSaved: false,
        dangerous: false,
        bubbled: 'none',
        eolAt: null,
        createdAt: now,
        updatedAt: now,
      };
      if (!(await this.ports.connections.insert(connection))) {
        // Another request connected the pair since `findBetween`.
        const raced = await this.ports.connections.findBetween(mapId, request.source, request.target);
        if (raced) return raced;
        throw new ConflictError('The connection changed meanwhile, try again');
      }
      events.add('connection.added', connection);
      return connection;
    });
  }

  /** Time, mass, size, type, mass-saved, dangerous and bubbled. Marking EOL stamps `eolAt`. */
  async update(
    actor: Actor | null,
    mapId: string,
    connectionId: string,
    request: UpdateConnectionRequest,
  ): Promise<Connection> {
    const who = await this.authorize(actor, mapId, 'member');
    return this.write(who, mapId, async (events) => {
      const current = await this.load(mapId, connectionId);
      const patch = defined(request);
      if (!changes(current, patch)) return current;
      const now = this.ports.clock.now();
      const next: Connection = { ...current, ...patch, updatedAt: now };
      if (patch.timeStatus) next.eolAt = patch.timeStatus === 'eol' ? (current.eolAt ?? now) : null;
      await this.ports.connections.update(next);
      events.add('connection.updated', next, current);
      return next;
    });
  }

  async remove(actor: Actor | null, mapId: string, connectionId: string): Promise<void> {
    const who = await this.authorize(actor, mapId, 'member');
    await this.write(who, mapId, async (events) => {
      await removeConnection(this.ports, events, await this.load(mapId, connectionId));
    });
  }

  private async load(mapId: string, connectionId: string): Promise<Connection> {
    const connection = await this.ports.connections.findById(mapId, connectionId);
    if (!connection) throw new NotFoundError('Connection');
    return connection;
  }
}
