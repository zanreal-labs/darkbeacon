import { ConflictError, NotFoundError, ValidationError, newId, type Actor } from '@darkbeacon/core';
import type { AddConnectionRequest, UpdateConnectionRequest } from '@darkbeacon/shared';
import type { Connection, Signature } from '../domain/map.js';
import { changes, defaultShipSize, defined } from '../domain/rules.js';
import { pairKey, signatureKey } from '../domain/stamps.js';
import { MappingUseCases, type EventBatch, type MappingPorts } from './base.js';
import { renumberBookmarks } from './bookmark-numbers.js';
import { removeConnection } from './systems.js';

export class ConnectionUseCases extends MappingUseCases {
  /**
   * Connects two visible systems. Returns the existing connection when they are already linked
   * (in either direction), so auto-mapping can call it blindly.
   */
  async add(actor: Actor | null, mapId: string, request: AddConnectionRequest): Promise<Connection> {
    const who = await this.authorizeEdit(actor, mapId);
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
        massStatusAt: null,
        bookmarkNumber: null,
        bookmarkParent: null,
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
      // A new wormhole takes the lowest free number among the wormholes out of its parent.
      const numbered = await renumberBookmarks(this.ports, events, mapId);
      return numbered.get(connection.id) ?? connection;
    });
  }

  /**
   * Time, mass, size, type, mass-saved, dangerous and bubbled. Marking EOL stamps `eolAt`; setting
   * the mass status stamps `massStatusAt`, from when mass estimates count passages.
   */
  async update(
    actor: Actor | null,
    mapId: string,
    connectionId: string,
    request: UpdateConnectionRequest,
  ): Promise<Connection> {
    const who = await this.authorizeEdit(actor, mapId);
    return this.write(who, mapId, async (events) => {
      const current = await this.load(mapId, connectionId);
      const patch = defined(request);
      if (!changes(current, patch)) return current;
      const next = patchConnection(current, patch, this.ports.clock.now());
      await this.ports.connections.update(next);
      events.add('connection.updated', next, current);
      // Only wormholes are numbered.
      if (next.type !== current.type) {
        const numbered = await renumberBookmarks(this.ports, events, mapId);
        return numbered.get(next.id) ?? next;
      }
      return next;
    });
  }

  /**
   * `withSignatures`: the signatures leading through it are removed too (the hole is gone, so are
   * its signatures), and a temporary name they gave a system is cleared; otherwise they are only
   * unlinked.
   */
  async remove(
    actor: Actor | null,
    mapId: string,
    connectionId: string,
    options: { withSignatures?: boolean } = {},
  ): Promise<void> {
    const who = await this.authorizeEdit(actor, mapId);
    await this.write(who, mapId, async (events) => {
      const connection = await this.load(mapId, connectionId);
      const now = this.ports.clock.now();
      // A deliberate removal (the hole closed): maps merging this one drop older copies too.
      await this.ports.stamps.putTombstone(
        mapId,
        'connection',
        pairKey(connection.source, connection.target),
        now,
      );
      if (options.withSignatures) await removeLinkedSignatures(this.ports, events, connection, now);
      await removeConnection(this.ports, events, connection);
      // Siblings keep their numbers (a gap), unless the map renumbers on close.
      await renumberBookmarks(this.ports, events, mapId);
    });
  }

  private async load(mapId: string, connectionId: string): Promise<Connection> {
    const connection = await this.ports.connections.findById(mapId, connectionId);
    if (!connection) throw new NotFoundError('Connection');
    return connection;
  }
}

/**
 * `current` with `patch` applied at `now`: marking EOL stamps `eolAt` (kept when it already was),
 * leaving it clears it; a new mass status stamps `massStatusAt`.
 */
export function patchConnection(current: Connection, patch: Partial<Connection>, now: number): Connection {
  const next: Connection = { ...current, ...patch, updatedAt: now };
  if (patch.timeStatus) next.eolAt = patch.timeStatus === 'eol' ? (current.eolAt ?? now) : null;
  if (patch.massStatus && patch.massStatus !== current.massStatus) next.massStatusAt = now;
  return next;
}

/**
 * Removes the signatures that lead through `connection` (in visible systems), and clears a
 * system's temporary name when one of them gave it.
 */
export async function removeLinkedSignatures(
  ports: MappingPorts,
  events: EventBatch,
  connection: Connection,
  now: number,
): Promise<Signature[]> {
  const removed: Signature[] = [];
  for (const [here, there] of [
    [connection.source, connection.target],
    [connection.target, connection.source],
  ] as const) {
    const system = await ports.systems.find(connection.mapId, here);
    if (!system?.visible) continue;
    for (const signature of await ports.signatures.listForSystem(connection.mapId, here)) {
      if (signature.connectionId !== connection.id) continue;
      await ports.stamps.putTombstone(
        connection.mapId,
        'signature',
        signatureKey(signature.solarSystemId, signature.eveId),
        now,
      );
      await ports.signatures.delete(connection.mapId, signature.id);
      events.add('signature.removed', { id: signature.id, solarSystemId: here }, signature);
      removed.push(signature);
      if (signature.tempName) {
        const target = await ports.systems.find(connection.mapId, there);
        if (target?.visible && target.temporaryName === signature.tempName) {
          const next = { ...target, temporaryName: null, updatedAt: now };
          await ports.systems.update(next);
          events.add('system.updated', next, target);
        }
      }
    }
  }
  return removed;
}
