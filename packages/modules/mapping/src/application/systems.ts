import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  hasMapRole,
  type Actor,
} from '@darkbeacon/core';
import { type AddSystemRequest, type MoveSystemsRequest, type UpdateSystemRequest } from '@darkbeacon/shared';
import type { Connection, MapSystem } from '../domain/map.js';
import { placeSystem } from '../domain/placement.js';
import { changes, defined } from '../domain/rules.js';
import { MappingUseCases, type EventBatch, type MappingPorts, type UpdateOptions } from './base.js';
import { renumberBookmarks } from './bookmark-numbers.js';
import { guardPinged } from './pings.js';

/**
 * Systems on a map. Removing a system only hides it: its attributes and signatures stay, its
 * connections go, and nothing about it is published until it is added again (restored).
 */
export class SystemUseCases extends MappingUseCases {
  /** Adds a system, restores a hidden one, or returns the visible one unchanged. */
  async add(actor: Actor | null, mapId: string, request: AddSystemRequest): Promise<MapSystem> {
    const who = await this.authorizeEdit(actor, mapId);
    if (!this.ports.universe.getSystem(request.solarSystemId)) throw new NotFoundError('Solar system');
    return this.write(who, mapId, async (events) => {
      const existing = await this.ports.systems.find(mapId, request.solarSystemId);
      if (existing?.visible) return existing;
      // Nobody dragged it: the map's placement rule, back to its old spot if that still fits.
      const position =
        request.position ??
        placeSystem(await this.ports.systems.list(mapId), await this.ports.connections.list(mapId), {
          near: request.near ?? null,
          around: request.around ?? null,
          previous: existing?.position ?? null,
        });
      if (existing) return this.restore(events, { ...existing, position }, existing);

      const now = this.ports.clock.now();
      const system: MapSystem = {
        mapId,
        solarSystemId: request.solarSystemId,
        position,
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
        createdAt: now,
        updatedAt: now,
      };
      await this.ports.systems.insert(system);
      events.add('system.added', system);
      return system;
    });
  }

  /**
   * Changes attributes. `visible: false` hides (like remove) and `visible: true` restores.
   * A locked system cannot be moved or hidden unless the same request unlocks it.
   */
  async update(
    actor: Actor | null,
    mapId: string,
    solarSystemId: number,
    request: UpdateSystemRequest,
    options: UpdateOptions = {},
  ): Promise<MapSystem> {
    const who = await this.authorizeEdit(actor, mapId);
    return this.write(who, mapId, async (events) => {
      const current = await this.ports.systems.find(mapId, solarSystemId);
      if (!current || (!current.visible && request.visible !== true)) throw new NotFoundError('System');
      const patch = defined(request);
      // Locking and unlocking is for managers, as in Wanderer (`lock_system`).
      if (patch.locked !== undefined && patch.locked !== current.locked)
        await this.authorize(who, mapId, 'manager');
      if (patch.labelIds) await this.checkLabels(mapId, patch.labelIds);
      if (patch.systemLabelIds) {
        patch.systemLabelIds = [...new Set(patch.systemLabelIds)];
        await this.checkSystemLabels(mapId, patch.systemLabelIds);
      }
      // An empty custom label is none.
      if (patch.customLabel !== undefined) patch.customLabel = patch.customLabel?.trim() || null;
      const written = (options.written ?? []).filter((field) => field in patch);
      if (!changes(current, patch) && written.length === 0) return current;

      const staysLocked = current.locked && (patch.locked ?? true);
      if (staysLocked) {
        if (patch.position && changes(current, { position: patch.position }))
          throw new ConflictError('The system is locked');
        if (patch.visible === false) throw new ConflictError('The system is locked');
      }

      const next: MapSystem = { ...current, ...patch, updatedAt: this.ports.clock.now() };
      if (!current.visible) {
        // Shown again where it stood if that still fits, else where the placement rule says.
        if (!patch.position) {
          const systems = await this.ports.systems.list(mapId);
          const connections = await this.ports.connections.list(mapId);
          next.position = placeSystem(systems, connections, { previous: current.position });
        }
        return this.restore(events, next, current);
      }
      if (!next.visible) {
        await guardPinged(this.ports.pings, mapId, solarSystemId);
        await this.guardLockedConnections(who, mapId, solarSystemId);
        await this.hide(events, next, current);
        await renumberBookmarks(this.ports, events, mapId);
        return next;
      }
      await this.ports.systems.update(next, { written });
      events.add('system.updated', next, current);
      // A new home turns the chain around it: wormholes may lead out of other systems now.
      if (next.status !== current.status) await renumberBookmarks(this.ports, events, mapId);
      return next;
    });
  }

  /** Batch move after a drag. Every system must be visible and unlocked. */
  async move(actor: Actor | null, mapId: string, request: MoveSystemsRequest): Promise<void> {
    const who = await this.authorizeEdit(actor, mapId);
    await this.write(who, mapId, async (events) => {
      const now = this.ports.clock.now();
      for (const { solarSystemId, x, y } of request.positions) {
        const current = await this.visibleSystem(mapId, solarSystemId);
        if (current.position.x === x && current.position.y === y) continue;
        if (current.locked) throw new ConflictError('A locked system cannot be moved', { solarSystemId });
        const next = { ...current, position: { x, y }, updatedAt: now };
        await this.ports.systems.update(next);
        events.add('system.updated', next, current);
      }
    });
  }

  /** Hides the system, keeping its intel. Locked systems stay. */
  async remove(actor: Actor | null, mapId: string, solarSystemId: number): Promise<void> {
    const who = await this.authorizeEdit(actor, mapId);
    await this.write(who, mapId, async (events) => {
      const current = await this.visibleSystem(mapId, solarSystemId);
      if (current.locked) throw new ConflictError('The system is locked');
      await guardPinged(this.ports.pings, mapId, solarSystemId);
      await this.guardLockedConnections(who, mapId, solarSystemId);
      await this.hide(events, { ...current, visible: false, updatedAt: this.ports.clock.now() }, current);
      await renumberBookmarks(this.ports, events, mapId);
    });
  }

  /**
   * Hiding a system removes its connections; a locked one may only go when a map manager hides
   * it, and never by a process acting on its own.
   */
  private async guardLockedConnections(who: Actor, mapId: string, solarSystemId: number): Promise<void> {
    const connections = await this.ports.connections.listForSystem(mapId, solarSystemId);
    if (!connections.some((c) => c.locked)) return;
    if (who.kind === 'system') throw new ConflictError('A locked connection leads to the system');
    if (!hasMapRole(await this.ports.access.roleOf(who, mapId), 'manager'))
      throw new ForbiddenError('A locked connection leads to the system; a map manager can remove it');
  }

  /** `before`: the system as it was shown, kept as the removed snapshot. */
  private async hide(events: EventBatch, system: MapSystem, before: MapSystem): Promise<void> {
    const hidden = { ...system, visible: false };
    await this.ports.systems.update(hidden);
    for (const connection of await this.ports.connections.listForSystem(system.mapId, system.solarSystemId)) {
      await removeConnection(this.ports, events, connection);
    }
    events.add('system.removed', { solarSystemId: system.solarSystemId }, before);
  }

  /** Makes a hidden system visible again and publishes it with the intel it kept. */
  private async restore(events: EventBatch, hidden: MapSystem, before: MapSystem): Promise<MapSystem> {
    const system: MapSystem = { ...hidden, visible: true, updatedAt: this.ports.clock.now() };
    await this.ports.systems.update(system);
    events.add('system.added', system, before);
    for (const signature of await this.ports.signatures.listForSystem(system.mapId, system.solarSystemId)) {
      events.add('signature.added', signature);
    }
    return system;
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
 * Deletes a connection and unlinks the signatures pointing at it. Signatures in hidden systems
 * change silently, so nothing is published about them.
 */
export async function removeConnection(
  ports: MappingPorts,
  events: EventBatch,
  connection: Connection,
): Promise<void> {
  await ports.connections.delete(connection.mapId, connection.id);
  const now = ports.clock.now();
  for (const solarSystemId of [connection.source, connection.target]) {
    const system = await ports.systems.find(connection.mapId, solarSystemId);
    for (const signature of await ports.signatures.listForSystem(connection.mapId, solarSystemId)) {
      if (signature.connectionId !== connection.id) continue;
      const next = { ...signature, connectionId: null, updatedAt: now };
      await ports.signatures.update(next);
      if (system?.visible) events.add('signature.updated', next, signature);
    }
  }
  events.add('connection.removed', { id: connection.id }, connection);
}
