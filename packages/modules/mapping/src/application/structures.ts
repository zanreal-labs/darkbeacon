import { ConflictError, NotFoundError, newId, type Actor } from '@darkbeacon/core';
import {
  TIMED_STRUCTURE_STATUSES,
  type AddStructureRequest,
  type AuthorDto,
  type PasteStructuresResult,
  type StructureOwnerDto,
  type StructureStatus,
  type UpdateStructureRequest,
} from '@darkbeacon/shared';
import type { Structure } from '../domain/map.js';
import { changes, defined } from '../domain/rules.js';
import { parseStructurePaste } from '../domain/structure-paste.js';
import type { StructureRepository } from '../ports/index.js';
import { MappingUseCases, type EventBatch, type MappingPorts } from './base.js';

/** Most structures one system keeps. */
export const MAX_STRUCTURES_PER_SYSTEM = 200;

export interface StructurePorts extends MappingPorts {
  structures: StructureRepository;
}

/** A status without a timer has no end time. */
function timed(status: StructureStatus, endsAt: number | null): number | null {
  return TIMED_STRUCTURE_STATUSES.includes(status) ? endsAt : null;
}

/**
 * Structures in the systems of a map: pasted from d-scan, timers pasted from the structure's
 * info, owners picked by corporation. Viewers read them, members change them. A hidden system
 * keeps its structures. Maps that merge others have none of their own.
 */
export class StructureUseCases extends MappingUseCases {
  constructor(protected override readonly ports: StructurePorts) {
    super(ports);
  }

  async list(actor: Actor | null, mapId: string, solarSystemId: number): Promise<Structure[]> {
    await this.authorize(actor, mapId, 'viewer');
    if (await this.ports.overlay?.view(mapId)) return [];
    await this.visibleSystem(mapId, solarSystemId);
    return this.ports.structures.listForSystem(mapId, solarSystemId);
  }

  /** Every structure in a visible system of the map, the soonest timer first, then by system. */
  async listMap(actor: Actor | null, mapId: string): Promise<Structure[]> {
    await this.authorize(actor, mapId, 'viewer');
    if (await this.ports.overlay?.view(mapId)) return [];
    const visible = new Set(
      (await this.ports.systems.list(mapId)).filter((s) => s.visible).map((s) => s.solarSystemId),
    );
    return (await this.ports.structures.listForMap(mapId))
      .filter((s) => visible.has(s.solarSystemId))
      .sort(
        (a, b) =>
          (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity) ||
          a.solarSystemId - b.solarSystemId ||
          a.createdAt - b.createdAt,
      );
  }

  async add(
    actor: Actor | null,
    mapId: string,
    solarSystemId: number,
    request: AddStructureRequest,
  ): Promise<Structure> {
    const who = await this.authorizeEdit(actor, mapId);
    const author = await this.author(who);
    return this.write(who, mapId, async (events) => {
      await this.visibleSystem(mapId, solarSystemId);
      await this.roomFor(mapId, solarSystemId, 1);
      const status = request.status ?? 'powered';
      return this.insert(events, author, {
        mapId,
        solarSystemId,
        typeId: request.typeId ?? null,
        typeName: request.typeName,
        name: request.name,
        owner: request.owner ?? null,
        status,
        endsAt: timed(status, request.endsAt ?? null),
        notes: request.notes ?? '',
      });
    });
  }

  async update(
    actor: Actor | null,
    mapId: string,
    structureId: string,
    request: UpdateStructureRequest,
  ): Promise<Structure> {
    const who = await this.authorizeEdit(actor, mapId);
    const author = await this.author(who);
    return this.write(who, mapId, async (events) => {
      const current = await this.load(mapId, structureId);
      const patch = defined(request) as Partial<Structure>;
      const status = patch.status ?? current.status;
      const endsAt = timed(status, patch.endsAt !== undefined ? patch.endsAt : current.endsAt);
      if (!changes(current, { ...patch, endsAt })) return current;
      return this.save(events, current, { ...patch, endsAt }, author);
    });
  }

  async remove(actor: Actor | null, mapId: string, structureId: string): Promise<void> {
    const who = await this.authorizeEdit(actor, mapId);
    await this.write(who, mapId, async (events) => {
      const structure = await this.load(mapId, structureId);
      await this.ports.structures.delete(mapId, structureId);
      events.add(
        'structure.removed',
        { id: structure.id, solarSystemId: structure.solarSystemId },
        structure,
      );
    });
  }

  /** One owner for every structure of a system ("update all structure owners"). */
  async setOwners(
    actor: Actor | null,
    mapId: string,
    solarSystemId: number,
    owner: StructureOwnerDto | null,
  ): Promise<Structure[]> {
    const who = await this.authorizeEdit(actor, mapId);
    const author = await this.author(who);
    return this.write(who, mapId, async (events) => {
      await this.visibleSystem(mapId, solarSystemId);
      const out: Structure[] = [];
      for (const current of await this.ports.structures.listForSystem(mapId, solarSystemId)) {
        out.push(changes(current, { owner }) ? await this.save(events, current, { owner }, author) : current);
      }
      return out;
    });
  }

  /**
   * D-scan rows add the structures not listed yet (same type and name); a timer sets the status
   * and end time of the structure of that name.
   */
  async paste(
    actor: Actor | null,
    mapId: string,
    solarSystemId: number,
    text: string,
  ): Promise<PasteStructuresResult> {
    const who = await this.authorizeEdit(actor, mapId);
    const author = await this.author(who);
    const parsed = parseStructurePaste(text);
    return this.write(who, mapId, async (events) => {
      await this.visibleSystem(mapId, solarSystemId);
      const existing = await this.ports.structures.listForSystem(mapId, solarSystemId);
      if (parsed.kind === 'timer') {
        const { timer } = parsed;
        const target = existing.find((s) => s.name.trim().toLowerCase() === timer.name.toLowerCase());
        if (!target) return { added: 0, updated: 0, skipped: [timer.name] };
        const patch = { status: timer.status, endsAt: timer.endsAt };
        if (!changes(target, patch)) return { added: 0, updated: 0, skipped: [] };
        await this.save(events, target, patch, author);
        return { added: 0, updated: 1, skipped: [] };
      }
      const fresh = parsed.structures.filter(
        (p) => !existing.some((s) => s.typeId === p.typeId && s.name.trim() === p.name),
      );
      await this.roomFor(mapId, solarSystemId, fresh.length);
      for (const p of fresh) {
        await this.insert(events, author, {
          mapId,
          solarSystemId,
          typeId: p.typeId,
          typeName: p.typeName,
          name: p.name,
          owner: null,
          status: 'powered',
          endsAt: null,
          notes: '',
        });
      }
      return { added: fresh.length, updated: 0, skipped: parsed.skipped };
    });
  }

  /** Puts a removed structure back as it was (the revert of a removal). */
  async restore(actor: Actor | null, mapId: string, structure: Structure): Promise<Structure> {
    const who = await this.authorizeEdit(actor, mapId);
    return this.write(who, mapId, async (events) => {
      await this.visibleSystem(mapId, structure.solarSystemId);
      if (await this.ports.structures.findById(mapId, structure.id))
        throw new ConflictError('The structure is already back');
      const restored: Structure = { ...structure, mapId, updatedAt: this.ports.clock.now() };
      await this.ports.structures.insert(restored);
      events.add('structure.added', restored);
      return restored;
    });
  }

  private async insert(
    events: EventBatch,
    author: AuthorDto | null,
    fields: Omit<Structure, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>,
  ): Promise<Structure> {
    const now = this.ports.clock.now();
    const structure: Structure = {
      id: newId(),
      ...fields,
      createdBy: author,
      updatedBy: author,
      createdAt: now,
      updatedAt: now,
    };
    await this.ports.structures.insert(structure);
    events.add('structure.added', structure);
    return structure;
  }

  private async save(
    events: EventBatch,
    current: Structure,
    patch: Partial<Structure>,
    author: AuthorDto | null,
  ): Promise<Structure> {
    const next: Structure = { ...current, ...patch, updatedAt: this.ports.clock.now(), updatedBy: author };
    next.endsAt = timed(next.status, next.endsAt);
    await this.ports.structures.update(next);
    events.add('structure.updated', next, current);
    return next;
  }

  private async roomFor(mapId: string, solarSystemId: number, more: number): Promise<void> {
    const count = (await this.ports.structures.listForSystem(mapId, solarSystemId)).length;
    if (count + more > MAX_STRUCTURES_PER_SYSTEM)
      throw new ConflictError('This system has too many structures; remove some first');
  }

  private async author(actor: Actor): Promise<AuthorDto | null> {
    return (await this.ports.authors?.author(actor)) ?? null;
  }

  /** A structure in a visible system. */
  private async load(mapId: string, structureId: string): Promise<Structure> {
    const structure = await this.ports.structures.findById(mapId, structureId);
    if (!structure) throw new NotFoundError('Structure');
    await this.visibleSystem(mapId, structure.solarSystemId).catch(() => {
      throw new NotFoundError('Structure');
    });
    return structure;
  }
}
