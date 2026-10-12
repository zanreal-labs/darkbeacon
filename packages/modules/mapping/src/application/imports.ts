import { ConflictError, NotFoundError, ValidationError, newId, type Actor } from '@darkbeacon/core';
import {
  AddSignatureRequest,
  UpdateConnectionRequest,
  UpdateSystemRequest,
  type ConnectionDto,
  type LabelDto,
  type MapSystemDto,
  type SignatureDto,
} from '@darkbeacon/shared';
import type { Connection, MapSystem, Signature } from '../domain/map.js';
import { changes, defaultShipSize, defined, validateLabels } from '../domain/rules.js';
import { MappingUseCases, type EventBatch } from './base.js';
import { removeConnection } from './systems.js';

/** System attributes an import may set. */
export type ImportedSystemFields = Partial<
  Pick<
    MapSystemDto,
    | 'position'
    | 'customName'
    | 'temporaryName'
    | 'tag'
    | 'status'
    | 'description'
    | 'labelIds'
    | 'locked'
    | 'visible'
  >
>;

/** Connection attributes an import may set, the timestamps the source knew included. */
export type ImportedConnectionFields = Partial<
  Pick<
    ConnectionDto,
    | 'type'
    | 'timeStatus'
    | 'massStatus'
    | 'shipSize'
    | 'massSaved'
    | 'dangerous'
    | 'bubbled'
    | 'eolAt'
    | 'massStatusAt'
  >
>;

export type ImportedSignatureFields = Partial<
  Pick<SignatureDto, 'group' | 'type' | 'name' | 'description' | 'connectionId'>
>;

export type ImportOutcome = 'created' | 'updated' | 'unchanged';

/**
 * Writes another mapper's chain into a map (imports from Wanderer). Unlike the editing use cases
 * it takes whole attribute sets and the times the source knew (when a connection was first seen,
 * when it went end of life), so lifetimes and mass estimates carry over. The map's rules still
 * hold: systems must exist in the universe, connections join two visible systems once per pair,
 * a signature links only a connection of its own system, and hidden systems stay silent.
 * Members may write systems, connections and signatures; labels need a manager.
 */
export class ChainImportUseCases extends MappingUseCases {
  /** Every system of the map, hidden ones included (the import merges into hidden ones too). */
  async systems(actor: Actor | null, mapId: string): Promise<MapSystem[]> {
    await this.authorize(actor, mapId, 'viewer');
    return this.ports.systems.list(mapId);
  }

  async connections(actor: Actor | null, mapId: string): Promise<Connection[]> {
    await this.authorize(actor, mapId, 'viewer');
    return this.ports.connections.list(mapId);
  }

  /** Every signature of the map, those of hidden systems included. */
  async signatures(actor: Actor | null, mapId: string): Promise<Signature[]> {
    await this.authorize(actor, mapId, 'viewer');
    return this.ports.signatures.listForMap(mapId);
  }

  /**
   * Creates the system with `fields` (defaults for the rest) or changes the given fields of the
   * existing one. Hiding removes its connections; showing a hidden one publishes it with its
   * signatures again, as the editing use cases do.
   */
  async putSystem(
    actor: Actor | null,
    mapId: string,
    solarSystemId: number,
    fields: ImportedSystemFields,
    createdAt?: number,
  ): Promise<{ system: MapSystem; outcome: ImportOutcome }> {
    const who = await this.authorize(actor, mapId, 'member');
    if (!this.ports.universe.getSystem(solarSystemId)) throw new NotFoundError('Solar system');
    const patch = defined(UpdateSystemRequest.parse(fields)) as ImportedSystemFields;
    return this.write(who, mapId, async (events) => {
      if (patch.labelIds) await this.checkLabels(mapId, patch.labelIds);
      const now = this.ports.clock.now();
      const current = await this.ports.systems.find(mapId, solarSystemId);
      if (!current) {
        const system: MapSystem = {
          mapId,
          solarSystemId,
          position: { x: 0, y: 0 },
          customName: null,
          temporaryName: null,
          tag: null,
          status: 'unknown',
          description: '',
          labelIds: [],
          locked: false,
          visible: true,
          ...patch,
          createdAt: Math.min(createdAt ?? now, now),
          updatedAt: now,
        };
        await this.ports.systems.insert(system);
        if (system.visible) events.add('system.added', system);
        return { system, outcome: 'created' };
      }
      if (!changes(current, patch)) return { system: current, outcome: 'unchanged' };
      const next: MapSystem = { ...current, ...patch, updatedAt: now };
      await this.ports.systems.update(next);
      if (current.visible && !next.visible) await this.hidden(events, next, current);
      else if (!current.visible && next.visible) await this.shown(events, next, current);
      else if (next.visible) events.add('system.updated', next, current);
      return { system: next, outcome: 'updated' };
    });
  }

  /**
   * Creates the connection between two visible systems with `fields`, or changes the given fields
   * of the one that joins them already (in either direction).
   */
  async putConnection(
    actor: Actor | null,
    mapId: string,
    pair: { source: number; target: number },
    fields: ImportedConnectionFields,
    createdAt?: number,
  ): Promise<{ connection: Connection; outcome: ImportOutcome }> {
    const who = await this.authorize(actor, mapId, 'member');
    if (pair.source === pair.target) throw new ValidationError('A system cannot connect to itself');
    const { eolAt, massStatusAt, ...rest } = fields;
    const patch: ImportedConnectionFields = {
      ...defined(UpdateConnectionRequest.parse(rest)),
      ...(eolAt !== undefined ? { eolAt } : {}),
      ...(massStatusAt !== undefined ? { massStatusAt } : {}),
    };
    return this.write(who, mapId, async (events) => {
      await this.visibleSystem(mapId, pair.source);
      await this.visibleSystem(mapId, pair.target);
      const now = this.ports.clock.now();
      const current = await this.ports.connections.findBetween(mapId, pair.source, pair.target);
      if (current) {
        if (!changes(current, patch)) return { connection: current, outcome: 'unchanged' as const };
        const next: Connection = { ...current, ...patch, updatedAt: now };
        if (next.timeStatus === 'normal') next.eolAt = null;
        else if (next.eolAt === null) next.eolAt = now;
        await this.ports.connections.update(next);
        events.add('connection.updated', next, current);
        return { connection: next, outcome: 'updated' as const };
      }
      const { universe } = this.ports;
      const type = patch.type ?? (universe.gateLinked(pair.source, pair.target) ? 'gate' : 'wormhole');
      const connection: Connection = {
        id: newId(),
        mapId,
        source: pair.source,
        target: pair.target,
        type,
        timeStatus: 'normal',
        massStatus: 'fresh',
        shipSize: defaultShipSize(type, universe.getSystem(pair.source), universe.getSystem(pair.target)),
        massSaved: false,
        dangerous: false,
        bubbled: 'none',
        eolAt: null,
        massStatusAt: null,
        ...patch,
        createdAt: Math.min(createdAt ?? now, now),
        updatedAt: now,
      };
      if (connection.timeStatus === 'normal') connection.eolAt = null;
      else if (connection.eolAt === null) connection.eolAt = now;
      if (!(await this.ports.connections.insert(connection))) {
        const raced = await this.ports.connections.findBetween(mapId, pair.source, pair.target);
        if (raced) return { connection: raced, outcome: 'unchanged' as const };
        throw new ConflictError('The connection changed meanwhile, try again');
      }
      events.add('connection.added', connection);
      return { connection, outcome: 'created' as const };
    });
  }

  /**
   * Creates the signature `eveId` in the system with `fields`, or changes the given fields of the
   * one with that id. The system may be hidden (its intel is kept; nothing is published then).
   * A linked connection must start or end in the system and makes the signature a wormhole.
   */
  async putSignature(
    actor: Actor | null,
    mapId: string,
    solarSystemId: number,
    eveId: string,
    fields: ImportedSignatureFields,
    createdAt?: number,
  ): Promise<{ signature: Signature; outcome: ImportOutcome }> {
    const who = await this.authorize(actor, mapId, 'member');
    const { connectionId, ...rest } = fields;
    const checked = AddSignatureRequest.parse({ eveId, ...rest });
    const patch: ImportedSignatureFields = {
      ...defined({
        group: checked.group,
        type: checked.type,
        name: checked.name,
        description: checked.description,
      }),
      ...(connectionId !== undefined ? { connectionId } : {}),
    };
    return this.write(who, mapId, async (events) => {
      const system = await this.ports.systems.find(mapId, solarSystemId);
      if (!system) throw new NotFoundError('System');
      if (patch.connectionId) {
        const connection = await this.ports.connections.findById(mapId, patch.connectionId);
        if (!connection) throw new ValidationError('Unknown connection');
        if (connection.source !== solarSystemId && connection.target !== solarSystemId)
          throw new ValidationError('The connection does not start or end in this system');
        patch.group = 'wormhole';
      }
      const now = this.ports.clock.now();
      const current = (await this.ports.signatures.listForSystem(mapId, solarSystemId)).find(
        (s) => s.eveId === checked.eveId,
      );
      if (current) {
        if (!changes(current, patch)) return { signature: current, outcome: 'unchanged' as const };
        const next: Signature = { ...current, ...patch, updatedAt: now };
        await this.ports.signatures.update(next);
        if (system.visible) events.add('signature.updated', next, current);
        return { signature: next, outcome: 'updated' as const };
      }
      const signature: Signature = {
        id: newId(),
        mapId,
        solarSystemId,
        eveId: checked.eveId,
        group: 'unknown',
        type: null,
        name: null,
        description: '',
        connectionId: null,
        ...patch,
        createdAt: Math.min(createdAt ?? now, now),
        updatedAt: now,
      };
      await this.ports.signatures.insert(signature);
      if (system.visible) events.add('signature.added', signature);
      return { signature, outcome: 'created' as const };
    });
  }

  /**
   * Adds the labels whose names the map does not have yet (manager+); names compare without case.
   * Returns the map's whole label list.
   */
  async ensureLabels(
    actor: Actor | null,
    mapId: string,
    wanted: ReadonlyArray<Omit<LabelDto, 'id'>>,
  ): Promise<LabelDto[]> {
    const who = await this.authorize(actor, mapId, 'manager');
    return this.write(who, mapId, async (events) => {
      const map = await this.ports.maps.findById(mapId);
      if (!map) throw new NotFoundError('Map');
      const known = new Set(map.labels.map((l) => l.name.toLowerCase()));
      const added: LabelDto[] = [];
      for (const label of wanted) {
        if (known.has(label.name.toLowerCase())) continue;
        known.add(label.name.toLowerCase());
        added.push({ id: newId(), ...label });
      }
      if (added.length === 0) return map.labels;
      const labels = [...map.labels, ...added];
      if (labels.length > 64) throw new ValidationError('A map holds at most 64 labels');
      validateLabels(labels);
      await this.ports.maps.update({ ...map, labels, updatedAt: this.ports.clock.now() });
      events.add('labels.changed', { labels }, { labels: map.labels });
      return labels;
    });
  }

  private async hidden(events: EventBatch, system: MapSystem, before: MapSystem): Promise<void> {
    for (const connection of await this.ports.connections.listForSystem(system.mapId, system.solarSystemId)) {
      await removeConnection(this.ports, events, connection);
    }
    events.add('system.removed', { solarSystemId: system.solarSystemId }, before);
  }

  private async shown(events: EventBatch, system: MapSystem, before: MapSystem): Promise<void> {
    events.add('system.added', system, before);
    for (const signature of await this.ports.signatures.listForSystem(system.mapId, system.solarSystemId)) {
      events.add('signature.added', signature);
    }
  }

  private async checkLabels(mapId: string, labelIds: string[]): Promise<void> {
    const map = await this.ports.maps.findById(mapId);
    const known = new Set(map?.labels.map((l) => l.id));
    const unknown = labelIds.filter((id) => !known.has(id));
    if (unknown.length > 0) throw new ValidationError('Unknown label', { labelIds: unknown });
  }
}
