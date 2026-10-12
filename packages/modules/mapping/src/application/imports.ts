import { ConflictError, NotFoundError, ValidationError, newId, type Actor } from '@darkbeacon/core';
import {
  AddSignatureRequest,
  UpdateConnectionRequest,
  UpdateSystemRequest,
  type ConnectionDto,
  type LabelDto,
  type MapSystemDto,
  type SignatureDto,
  type SystemLabelDto,
} from '@darkbeacon/shared';
import type { Connection, MapSystem, Passage, Signature } from '../domain/map.js';
import {
  changes,
  compactConnection,
  compactSignature,
  defaultShipSize,
  defined,
  validateLabels,
  validateSystemLabels,
} from '../domain/rules.js';
import { MappingUseCases, type EventBatch } from './base.js';
import { renumberBookmarks } from './bookmark-numbers.js';
import { passageEvent } from './intel.js';
import { removeConnection } from './systems.js';

/** System attributes an import may set. */
export type ImportedSystemFields = Partial<
  Pick<
    MapSystemDto,
    | 'position'
    | 'customName'
    | 'temporaryName'
    | 'status'
    | 'description'
    | 'labelIds'
    | 'systemLabelIds'
    | 'customLabel'
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
    | 'locked'
    | 'note'
    | 'lifetime'
  >
>;

export type ImportedSignatureFields = Partial<
  Pick<SignatureDto, 'group' | 'type' | 'name' | 'description' | 'connectionId' | 'kind' | 'custom'>
>;

/** A ship another mapper saw go through a connection. */
export interface ImportedPassage {
  source: number;
  target: number;
  characterId: number;
  shipTypeId: number | null;
  occurredAt: number;
}

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
    changedAt?: number,
  ): Promise<{ system: MapSystem; outcome: ImportOutcome }> {
    const who = await this.authorizeEdit(actor, mapId);
    if (!this.ports.universe.getSystem(solarSystemId)) throw new NotFoundError('Solar system');
    const patch = defined(UpdateSystemRequest.parse(fields)) as ImportedSystemFields;
    return this.write(who, mapId, async (events) => {
      if (patch.labelIds) await this.checkLabels(mapId, patch.labelIds);
      if (patch.systemLabelIds) await this.checkSystemLabels(mapId, patch.systemLabelIds);
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
          systemLabelIds: [],
          customLabel: null,
          locked: false,
          visible: true,
          ...patch,
          createdAt: Math.min(createdAt ?? now, now),
          updatedAt: now,
        };
        system.updatedAt = changeTime(system.createdAt, changedAt, now);
        await this.ports.systems.insert(system);
        if (system.visible) events.add('system.added', system);
        return { system, outcome: 'created' };
      }
      if (!changes(current, patch)) return { system: current, outcome: 'unchanged' };
      const next: MapSystem = {
        ...current,
        ...patch,
        updatedAt: changeTime(current.updatedAt, changedAt, now),
      };
      await this.ports.systems.update(next);
      if (current.visible && !next.visible) {
        await this.hidden(events, next, current);
        await renumberBookmarks(this.ports, events, mapId);
      } else if (!current.visible && next.visible) await this.shown(events, next, current);
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
    changedAt?: number,
  ): Promise<{ connection: Connection; outcome: ImportOutcome }> {
    const who = await this.authorizeEdit(actor, mapId);
    if (pair.source === pair.target) throw new ValidationError('A system cannot connect to itself');
    const { eolAt, massStatusAt, lifetime, ...rest } = fields;
    const patch: ImportedConnectionFields = {
      ...defined(UpdateConnectionRequest.omit({ lifetime: true }).parse(rest)),
      ...(eolAt !== undefined ? { eolAt } : {}),
      ...(massStatusAt !== undefined ? { massStatusAt } : {}),
      ...(lifetime !== undefined ? { lifetime } : {}),
    };
    return this.write(who, mapId, async (events) => {
      await this.visibleSystem(mapId, pair.source);
      await this.visibleSystem(mapId, pair.target);
      const now = this.ports.clock.now();
      const current = await this.ports.connections.findBetween(mapId, pair.source, pair.target);
      if (current) {
        if (!changes(current, patch)) return { connection: current, outcome: 'unchanged' as const };
        const next: Connection = {
          ...current,
          ...patch,
          updatedAt: changeTime(current.updatedAt, changedAt, now),
        };
        if (next.timeStatus === 'normal') next.eolAt = null;
        else if (next.eolAt === null) next.eolAt = now;
        await this.ports.connections.update(next);
        events.add('connection.updated', next, current);
        // Only wormholes are numbered.
        if (next.type !== current.type) {
          const numbered = await renumberBookmarks(this.ports, events, mapId);
          return { connection: numbered.get(next.id) ?? next, outcome: 'updated' as const };
        }
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
        bookmarkNumber: null,
        bookmarkParent: null,
        ...patch,
        createdAt: Math.min(createdAt ?? now, now),
        updatedAt: now,
      };
      connection.updatedAt = changeTime(connection.createdAt, changedAt, now);
      // Defaults stay absent, as for connections made by hand.
      for (const key of ['locked', 'note', 'lifetime'] as const)
        if (!(key in compactConnection(connection))) delete connection[key];
      if (connection.timeStatus === 'normal') connection.eolAt = null;
      else if (connection.eolAt === null) connection.eolAt = now;
      if (!(await this.ports.connections.insert(connection))) {
        const raced = await this.ports.connections.findBetween(mapId, pair.source, pair.target);
        if (raced) return { connection: raced, outcome: 'unchanged' as const };
        throw new ConflictError('The connection changed meanwhile, try again');
      }
      events.add('connection.added', connection);
      // A new wormhole takes the lowest free number among the wormholes out of its parent.
      const numbered = await renumberBookmarks(this.ports, events, mapId);
      return { connection: numbered.get(connection.id) ?? connection, outcome: 'created' as const };
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
    changedAt?: number,
  ): Promise<{ signature: Signature; outcome: ImportOutcome }> {
    const who = await this.authorizeEdit(actor, mapId);
    const { connectionId, ...rest } = fields;
    const checked = AddSignatureRequest.parse({ eveId, ...rest });
    const patch: ImportedSignatureFields = {
      ...defined({
        group: checked.group,
        type: checked.type,
        name: checked.name,
        description: checked.description,
        kind: checked.kind,
        custom: checked.custom,
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
        const next: Signature = {
          ...current,
          ...patch,
          updatedAt: changeTime(current.updatedAt, changedAt, now),
        };
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
      signature.updatedAt = changeTime(signature.createdAt, changedAt, now);
      const compact = compactSignature(signature);
      if (!('kind' in compact)) delete signature.kind;
      if (!('custom' in compact)) delete signature.custom;
      await this.ports.signatures.insert(signature);
      if (system.visible) events.add('signature.added', signature);
      return { signature, outcome: 'created' as const };
    });
  }

  /**
   * Records a passage another mapper saw, under its stable id there (`externalId`), so the same
   * passage is recorded once however often it is imported. The hull mass comes from the SDE, as
   * for passages recorded here. Skipped (false) when the map does not connect the two systems.
   */
  async putPassage(
    actor: Actor | null,
    mapId: string,
    passage: ImportedPassage,
    externalId: string,
  ): Promise<'created' | 'unchanged' | 'skipped'> {
    const who = await this.authorizeEdit(actor, mapId);
    return this.write(who, mapId, async (events) => {
      const connection = await this.ports.connections.findBetween(mapId, passage.source, passage.target);
      if (!connection) return 'skipped';
      // A jump Wanderer saw a tracked pilot make: counted cold, like a tracked jump here.
      const record: Passage = {
        id: newId(),
        connectionId: connection.id,
        characterId: passage.characterId,
        shipTypeId: passage.shipTypeId,
        mass: passage.shipTypeId === null ? null : this.ports.universe.shipMass(passage.shipTypeId),
        from: passage.source,
        to: passage.target,
        occurredAt: Math.min(passage.occurredAt, this.ports.clock.now()),
        source: 'tracked',
        massMode: 'cold',
        higgs: false,
        entangler: false,
        note: null,
        createdBy: null,
      };
      // The id marks it as imported and keeps it unique (the table's event id).
      if (!(await this.ports.passages.insert(mapId, record, `import:${externalId}`))) return 'unchanged';
      events.add('connection.passage', passageEvent(record));
      return 'created';
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

  /**
   * The map's Labels (WH1, A, B...) for an import (manager+). `replace` (a new map) makes the list
   * exactly `wanted`; otherwise Labels the map lacks by name (any case) are added at the end, with
   * their own id unless the map uses it already. Returns the map's list.
   */
  async ensureSystemLabels(
    actor: Actor | null,
    mapId: string,
    wanted: readonly SystemLabelDto[],
    options: { replace: boolean },
  ): Promise<SystemLabelDto[]> {
    const who = await this.authorize(actor, mapId, 'manager');
    return this.write(who, mapId, async (events) => {
      const map = await this.ports.maps.findById(mapId);
      if (!map) throw new NotFoundError('Map');
      let systemLabels: SystemLabelDto[];
      if (options.replace) systemLabels = wanted.map((l) => ({ ...l }));
      else {
        systemLabels = [...map.systemLabels];
        const names = new Set(systemLabels.map((l) => l.name.toLowerCase()));
        const ids = new Set(systemLabels.map((l) => l.id));
        for (const label of wanted) {
          if (names.has(label.name.toLowerCase())) continue;
          const id = ids.has(label.id) ? newId() : label.id;
          names.add(label.name.toLowerCase());
          ids.add(id);
          systemLabels.push({ ...label, id });
        }
      }
      if (systemLabels.length > 32) throw new ValidationError('A map holds at most 32 labels');
      validateSystemLabels(systemLabels);
      if (!changes(map, { systemLabels })) return map.systemLabels;
      const now = this.ports.clock.now();
      await this.ports.maps.update({ ...map, systemLabels, updatedAt: now });
      events.add('system_labels.changed', { systemLabels }, { systemLabels: map.systemLabels });
      // Systems lose Labels that are gone (only when the list was replaced).
      const kept = new Set(systemLabels.map((l) => l.id));
      for (const system of await this.ports.systems.list(mapId)) {
        const systemLabelIds = system.systemLabelIds.filter((id) => kept.has(id));
        if (systemLabelIds.length === system.systemLabelIds.length) continue;
        const next = { ...system, systemLabelIds, updatedAt: now };
        await this.ports.systems.update(next);
        if (next.visible) events.add('system.updated', next, system);
      }
      return systemLabels;
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
    if (unknown.length > 0) throw new ValidationError('Unknown tag', { labelIds: unknown });
  }

  private async checkSystemLabels(mapId: string, systemLabelIds: string[]): Promise<void> {
    const map = await this.ports.maps.findById(mapId);
    const known = new Set(map?.systemLabels.map((l) => l.id));
    const unknown = systemLabelIds.filter((id) => !known.has(id));
    if (unknown.length > 0) throw new ValidationError('Unknown label', { systemLabelIds: unknown });
  }
}

/**
 * When an imported change happened: the source's own time (never in the future, never before
 * `floor`), so the field change times maps merging this one compare are Wanderer's, not the
 * moment of the import.
 */
function changeTime(floor: number, changedAt: number | undefined, now: number): number {
  return Math.max(floor, Math.min(changedAt ?? now, now));
}
