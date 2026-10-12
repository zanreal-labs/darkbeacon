import { newId, NotFoundError, type Actor } from '@darkbeacon/core';
import type { ConnectionIntelDto } from '@darkbeacon/shared';
import { byUrgency, connectionIntel } from '../domain/intel.js';
import type { Passage } from '../domain/map.js';
import { MappingUseCases } from './base.js';

/** The connections panel: every visible connection with derived type, mass and time, most urgent first. */
export class ConnectionIntelQuery extends MappingUseCases {
  async list(actor: Actor | null, mapId: string): Promise<ConnectionIntelDto[]> {
    await this.authorize(actor, mapId, 'viewer');
    const { universe } = this.ports;
    // A merged chain has no passages of its own: who jumped stays with the source maps.
    const merged = await this.ports.overlay?.view(mapId);
    const visible = new Set(
      (merged?.systems ?? (await this.ports.systems.list(mapId)))
        .filter((s) => s.visible)
        .map((s) => s.solarSystemId),
    );
    const connections = (merged?.connections ?? (await this.ports.connections.list(mapId))).filter(
      (c) => visible.has(c.source) && visible.has(c.target),
    );
    const signatures = merged?.signatures ?? (await this.ports.signatures.listForMap(mapId));
    const passages = merged ? [] : await this.ports.passages.listForMap(mapId);
    const now = this.ports.clock.now();
    return connections
      .map((connection) =>
        connectionIntel({
          connection,
          source: universe.getSystem(connection.source),
          target: universe.getSystem(connection.target),
          signatures: signatures.filter((s) => s.connectionId === connection.id),
          passages: passages.filter((p) => p.connectionId === connection.id),
          wormholeType: (code) => universe.wormholeType(code),
          hullClasses: universe.hullClasses(),
          now,
        }),
      )
      .sort(byUrgency);
  }

  /** Ships recorded through one connection, newest first. */
  async passages(actor: Actor | null, mapId: string, connectionId: string): Promise<Passage[]> {
    await this.authorize(actor, mapId, 'viewer');
    const connection = await this.ports.connections.findById(mapId, connectionId);
    if (!connection) throw new NotFoundError('Connection');
    await this.visibleSystem(mapId, connection.source);
    await this.visibleSystem(mapId, connection.target);
    return this.ports.passages.listForConnection(mapId, connectionId);
  }
}

/** A tracked character's jump, as read from the map's event stream. */
export interface ObservedJump {
  mapId: string;
  /** Id of the `character.jumped` event: a jump is recorded once. */
  eventId: string;
  characterId: number;
  shipTypeId: number | null;
  from: number;
  to: number;
  occurredAt: number;
}

const RECORDER: Actor = { kind: 'system', id: 'mapping' };

/**
 * Records jumps through the map's connections as passages (with the ship's hull mass) and
 * publishes `connection.passage`. Called by a durable consumer of the map streams, so it needs
 * no map role; jumps between systems with no connection on the map are ignored.
 */
export class PassageRecorder extends MappingUseCases {
  async record(jump: ObservedJump): Promise<boolean> {
    return this.write(RECORDER, jump.mapId, async (events) => {
      const connection = await this.ports.connections.findBetween(jump.mapId, jump.from, jump.to);
      if (!connection) return false;
      const passage: Passage = {
        id: newId(),
        connectionId: connection.id,
        characterId: jump.characterId,
        shipTypeId: jump.shipTypeId,
        mass: jump.shipTypeId === null ? null : this.ports.universe.shipMass(jump.shipTypeId),
        from: jump.from,
        to: jump.to,
        occurredAt: jump.occurredAt,
      };
      if (!(await this.ports.passages.insert(jump.mapId, passage, jump.eventId))) return false;
      events.add('connection.passage', {
        connectionId: connection.id,
        characterId: jump.characterId,
        shipTypeId: jump.shipTypeId,
        mass: passage.mass,
        from: jump.from,
        to: jump.to,
        passageId: passage.id,
      });
      return true;
    });
  }
}
