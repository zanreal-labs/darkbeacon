import {
  ConflictError,
  NotFoundError,
  newId,
  requireAccount,
  requireActor,
  type Actor,
} from '@darkbeacon/core';
import type { CreateMapRequest, LabelDto, MapSummaryDto, UpdateMapRequest } from '@darkbeacon/shared';
import type { ChainMap } from '../domain/map.js';
import { changes, slugify, validateLabels } from '../domain/rules.js';
import { MappingUseCases } from './base.js';

export class MapUseCases extends MappingUseCases {
  /** Maps the actor can at least view, sorted by name. */
  async list(actor: Actor | null): Promise<MapSummaryDto[]> {
    const grants = await this.ports.access.mapsFor(requireActor(actor));
    const roles = new Map(grants.map((g) => [g.mapId, g.role]));
    const maps = await this.ports.maps.listByIds([...roles.keys()]);
    return maps
      .map((m) => ({ id: m.id, slug: m.slug, name: m.name, role: roles.get(m.id)! }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(actor: Actor | null, mapId: string): Promise<ChainMap> {
    await this.authorize(actor, mapId, 'viewer');
    return this.load(mapId);
  }

  async getBySlug(actor: Actor | null, slug: string): Promise<ChainMap> {
    const map = await this.ports.maps.findBySlug(slug);
    if (!map) throw new NotFoundError('Map');
    await this.authorize(actor, map.id, 'viewer');
    return map;
  }

  /** Any signed-in account may create a map and becomes its owner. */
  async create(actor: Actor | null, request: CreateMapRequest): Promise<ChainMap> {
    const account = requireAccount(actor);
    const now = this.ports.clock.now();
    const map: ChainMap = {
      id: newId(),
      slug: request.slug ?? (await this.freeSlug(slugify(request.name))),
      name: request.name,
      ownerAccountId: account.id,
      settings: { scopes: ['wormhole'] },
      labels: [],
      createdAt: now,
      updatedAt: now,
    };
    return this.write(account, map.id, async (events) => {
      await this.ensureSlugFree(map.slug);
      await this.ports.maps.insert(map);
      events.add('map.created', map);
      return map;
    });
  }

  /** Name, slug and settings (admin). */
  async update(actor: Actor | null, mapId: string, request: UpdateMapRequest): Promise<ChainMap> {
    const who = await this.authorize(actor, mapId, 'admin');
    return this.write(who, mapId, async (events) => {
      const current = await this.load(mapId);
      const next: ChainMap = {
        ...current,
        name: request.name ?? current.name,
        slug: request.slug ?? current.slug,
        settings: {
          ...current.settings,
          ...(request.settings?.scopes ? { scopes: [...new Set(request.settings.scopes)] } : {}),
        },
      };
      if (!changes(current, next)) return current;
      if (next.slug !== current.slug) await this.ensureSlugFree(next.slug);
      next.updatedAt = this.ports.clock.now();
      await this.ports.maps.update(next);
      events.add('map.settings_changed', next, current);
      return next;
    });
  }

  /**
   * Replaces the label list (manager+). Systems lose the labels that no longer exist; hidden
   * systems are updated silently.
   */
  async setLabels(actor: Actor | null, mapId: string, labels: LabelDto[]): Promise<LabelDto[]> {
    const who = await this.authorize(actor, mapId, 'manager');
    validateLabels(labels);
    return this.write(who, mapId, async (events) => {
      const current = await this.load(mapId);
      if (!changes(current, { labels })) return current.labels;
      const now = this.ports.clock.now();
      await this.ports.maps.update({ ...current, labels, updatedAt: now });
      events.add('labels.changed', { labels }, { labels: current.labels });

      const kept = new Set(labels.map((l) => l.id));
      for (const system of await this.ports.systems.list(mapId)) {
        const labelIds = system.labelIds.filter((id) => kept.has(id));
        if (labelIds.length === system.labelIds.length) continue;
        const next = { ...system, labelIds, updatedAt: now };
        await this.ports.systems.update(next);
        if (next.visible) events.add('system.updated', next, system);
      }
      return labels;
    });
  }

  /** Deletes the map and everything on it (admin). */
  async remove(actor: Actor | null, mapId: string): Promise<void> {
    const who = await this.authorize(actor, mapId, 'admin');
    await this.write(who, mapId, async (events) => {
      const current = await this.load(mapId);
      await this.ports.maps.delete(mapId);
      events.add('map.removed', { id: mapId }, current);
    });
  }

  private async load(mapId: string): Promise<ChainMap> {
    const map = await this.ports.maps.findById(mapId);
    if (!map) throw new NotFoundError('Map');
    return map;
  }

  private async ensureSlugFree(slug: string): Promise<void> {
    if (await this.ports.maps.findBySlug(slug)) throw new ConflictError(`The address ${slug} is taken`);
  }

  /** `base`, or `base-2`, `base-3`... whichever is free first. */
  private async freeSlug(base: string): Promise<string> {
    for (let n = 1; ; n++) {
      const slug = n === 1 ? base : `${base}-${n}`;
      if (!(await this.ports.maps.findBySlug(slug))) return slug;
    }
  }
}
