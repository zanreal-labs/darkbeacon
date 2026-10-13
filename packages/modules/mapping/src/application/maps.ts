import {
  ConflictError,
  ForbiddenError,
  isInstanceAdmin,
  NotFoundError,
  newId,
  requireAccount,
  requireActor,
  requireInstanceRole,
  ValidationError,
  type Actor,
} from '@darkbeacon/core';
import {
  DEFAULT_BOOKMARK_NUMBERING,
  type AdminMapDto,
  DEFAULT_SYSTEM_LABELS,
  DEFAULT_TAGS,
  type BookmarkNumbering,
  type CreateMapRequest,
  type LabelDto,
  type MapSummaryDto,
  type MapViewDto,
  type SystemLabelDto,
  type UpdateMapRequest,
} from '@darkbeacon/shared';
import type { ChainMap } from '../domain/map.js';
import { changes, slugify, validateLabels, validateMapViews, validateSystemLabels } from '../domain/rules.js';
import { MappingUseCases, type EventBatch } from './base.js';
import { renumberBookmarks } from './bookmark-numbers.js';

export class MapUseCases extends MappingUseCases {
  /** Maps the actor can at least view, sorted by name. */
  async list(actor: Actor | null): Promise<MapSummaryDto[]> {
    const grants = await this.ports.access.mapsFor(requireActor(actor));
    const roles = new Map(grants.map((g) => [g.mapId, g.role]));
    const maps = await this.ports.maps.listByIds([...roles.keys()]);
    return maps
      .map((m) => ({
        id: m.id,
        slug: m.slug,
        name: m.name,
        ...(m.description ? { description: m.description } : {}),
        ...(m.kind ? { kind: m.kind } : {}),
        role: roles.get(m.id)!,
      }))
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

  /**
   * A signed-in account creates a map and becomes its owner; where the instance lets only admins
   * create maps, only they do. The map starts with the default Tags and Labels.
   */
  async create(actor: Actor | null, request: CreateMapRequest): Promise<ChainMap> {
    const account = requireAccount(actor);
    if (this.ports.directory && !(await this.ports.directory.mayCreateMaps(account)))
      throw new ForbiddenError('Only instance admins create maps on this instance');
    const now = this.ports.clock.now();
    const map: ChainMap = {
      id: newId(),
      slug: request.slug ?? (await this.freeSlug(slugify(request.name))),
      name: request.name,
      ...(request.description ? { description: request.description } : {}),
      ...(request.kind === 'composite' ? { kind: 'composite' as const } : {}),
      ownerAccountId: account.id,
      settings: { scopes: ['wormhole'] },
      labels: DEFAULT_TAGS.map((l) => ({ ...l })),
      systemLabels: DEFAULT_SYSTEM_LABELS.map((l) => ({ ...l })),
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

  /** Name, slug, description and settings (admin). */
  async update(actor: Actor | null, mapId: string, request: UpdateMapRequest): Promise<ChainMap> {
    const who = await this.authorize(actor, mapId, 'admin');
    return this.write(who, mapId, async (events) => {
      const current = await this.load(mapId);
      const { description: _description, ...rest } = current;
      const description = request.description ?? current.description ?? '';
      const next: ChainMap = {
        ...rest,
        ...(description ? { description } : {}),
        name: request.name ?? current.name,
        slug: request.slug ?? current.slug,
        settings: {
          ...current.settings,
          ...(request.settings?.scopes ? { scopes: [...new Set(request.settings.scopes)] } : {}),
          ...(request.settings?.bookmarkTemplate
            ? { bookmarkTemplate: request.settings.bookmarkTemplate }
            : {}),
          ...(request.settings?.bookmarkNumbering
            ? { bookmarkNumbering: request.settings.bookmarkNumbering }
            : {}),
          ...(request.settings?.signatureRetentionDays !== undefined
            ? { signatureRetentionDays: request.settings.signatureRetentionDays }
            : {}),
          ...(request.settings?.onlyTrackedCharacters !== undefined
            ? { onlyTrackedCharacters: request.settings.onlyTrackedCharacters }
            : {}),
          ...(request.settings?.offlineForManagersOnly !== undefined
            ? { offlineForManagersOnly: request.settings.offlineForManagersOnly }
            : {}),
          ...(request.settings?.autoMap ? { autoMap: request.settings.autoMap } : {}),
        },
      };
      if (!changes(current, next) && (current.description ?? '') === description) return current;
      if (next.slug !== current.slug) await this.ensureSlugFree(next.slug);
      next.updatedAt = this.ports.clock.now();
      await this.ports.maps.update(next);
      events.add('map.settings_changed', next, current);
      await this.applyNumbering(events, current, next);
      return next;
    });
  }

  /**
   * Replaces the Tags (`labels` in the data, manager+). Systems lose the tags that no longer
   * exist; hidden systems are updated silently.
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

  /**
   * Replaces the Labels (WH1, WH2..., manager+); their order is the order systems show them in.
   * Systems lose the labels that no longer exist; hidden systems are updated silently.
   */
  async setSystemLabels(
    actor: Actor | null,
    mapId: string,
    systemLabels: SystemLabelDto[],
  ): Promise<SystemLabelDto[]> {
    const who = await this.authorize(actor, mapId, 'manager');
    validateSystemLabels(systemLabels);
    return this.write(who, mapId, async (events) => {
      const current = await this.load(mapId);
      if (!changes(current, { systemLabels })) return current.systemLabels;
      const now = this.ports.clock.now();
      await this.ports.maps.update({ ...current, systemLabels, updatedAt: now });
      events.add('system_labels.changed', { systemLabels }, { systemLabels: current.systemLabels });

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

  /**
   * Replaces the map's published views (manager+): saved layouts of the map screen that every
   * member gets at once, `slot` pinning one to quick slot 1, 2 or 3 for everyone. A view whose
   * content changed is stamped with the time of the change.
   */
  async setViews(actor: Actor | null, mapId: string, views: MapViewDto[]): Promise<MapViewDto[]> {
    const who = await this.authorize(actor, mapId, 'manager');
    validateMapViews(views);
    return this.write(who, mapId, async (events) => {
      const current = await this.load(mapId);
      const before = current.views ?? [];
      const now = this.ports.clock.now();
      const old = new Map(before.map((v) => [v.id, v]));
      const next = views.map((v) => {
        const was = old.get(v.id);
        const same =
          was && JSON.stringify({ ...was, updatedAt: 0 }) === JSON.stringify({ ...v, updatedAt: 0 });
        return { ...v, updatedAt: same ? was.updatedAt : now };
      });
      if (JSON.stringify(before) === JSON.stringify(next)) return before;
      const { views: _views, ...rest } = current;
      await this.ports.maps.update({ ...rest, ...(next.length > 0 ? { views: next } : {}), updatedAt: now });
      events.add('views.changed', { views: next }, { views: before });
      return next;
    });
  }

  /**
   * The map's default bookmark label template (manager+), published with the map settings so
   * every open map relabels at once; null goes back to the built-in default.
   */
  async setBookmarkTemplate(actor: Actor | null, mapId: string, template: string | null): Promise<ChainMap> {
    const who = await this.authorize(actor, mapId, 'manager');
    return this.write(who, mapId, async (events) => {
      const current = await this.load(mapId);
      const { bookmarkTemplate: _old, ...settings } = current.settings;
      const next: ChainMap = {
        ...current,
        settings: template === null ? settings : { ...settings, bookmarkTemplate: template },
      };
      if ((current.settings.bookmarkTemplate ?? null) === template) return current;
      next.updatedAt = this.ports.clock.now();
      await this.ports.maps.update(next);
      events.add('map.settings_changed', next, current);
      return next;
    });
  }

  /**
   * The map's `{n}` numbering (manager+); null goes back to found order with gaps kept. A new
   * order numbers every system's wormholes again in it; turning on renumber on close closes the
   * gaps there are.
   */
  async setBookmarkNumbering(
    actor: Actor | null,
    mapId: string,
    numbering: BookmarkNumbering | null,
  ): Promise<ChainMap> {
    const who = await this.authorize(actor, mapId, 'manager');
    return this.write(who, mapId, async (events) => {
      const current = await this.load(mapId);
      const { bookmarkNumbering: _old, ...settings } = current.settings;
      const next: ChainMap = {
        ...current,
        settings: numbering === null ? settings : { ...settings, bookmarkNumbering: numbering },
      };
      if (!changes(current, next)) return current;
      next.updatedAt = this.ports.clock.now();
      await this.ports.maps.update(next);
      events.add('map.settings_changed', next, current);
      await this.applyNumbering(events, current, next);
      return next;
    });
  }

  /** After a settings change: renumber everything in a new order, else keep (or close gaps). */
  private async applyNumbering(events: EventBatch, before: ChainMap, after: ChainMap): Promise<void> {
    const was = before.settings.bookmarkNumbering ?? DEFAULT_BOOKMARK_NUMBERING;
    const is = after.settings.bookmarkNumbering ?? DEFAULT_BOOKMARK_NUMBERING;
    if (was.order === is.order && was.renumberOnClose === is.renumberOnClose) return;
    await renumberBookmarks(this.ports, events, after.id, {
      numbering: is,
      renumber: was.order === is.order ? 'none' : 'all',
    });
  }

  /**
   * Deletes the map (admin), softly: nobody can open it any more, but an instance admin can
   * restore it with everything on it, or purge it for good.
   */
  async remove(actor: Actor | null, mapId: string): Promise<void> {
    const who = await this.authorize(actor, mapId, 'admin');
    await this.trashAs(who, mapId);
  }

  /**
   * Hands the map to another account: its owner may, and an instance admin may for any map (also
   * a deleted one). The new owner is admin from then on; the old one keeps only what rules give.
   */
  async transferOwner(actor: Actor | null, mapId: string, accountId: string): Promise<ChainMap> {
    const who = requireActor(actor);
    const admin = isInstanceAdmin(who);
    if (!admin) {
      await this.authorize(who, mapId, 'admin');
      const map = await this.load(mapId);
      if (who.kind !== 'account' || who.id !== map.ownerAccountId)
        throw new ForbiddenError('Only the owner or an instance admin hands a map over');
    }
    const names = (await this.ports.directory?.accountNames([accountId])) ?? new Map<string, string>();
    if (!names.has(accountId)) throw new ValidationError('No such account');
    return this.write(who, mapId, async (events) => {
      const current = await this.load(mapId);
      if (current.ownerAccountId === accountId) return current;
      const next: ChainMap = { ...current, ownerAccountId: accountId, updatedAt: this.ports.clock.now() };
      await this.ports.maps.update(next);
      if (!current.deletedAt) events.add('map.settings_changed', next, current);
      events.add('access.owner_changed', {
        mapId,
        ownerAccountId: accountId,
        previousOwnerAccountId: current.ownerAccountId,
      });
      return next;
    });
  }

  /**
   * Every map of the instance for its admins: name, owner, size and whether it is deleted. Never
   * what is on it: instance admins hold no role on maps.
   */
  async inventory(actor: Actor | null): Promise<AdminMapDto[]> {
    requireInstanceRole(actor, 'admin');
    const maps = await this.ports.maps.listAll();
    const [systems, rules, names] = await Promise.all([
      this.ports.systems.countVisibleByMap(),
      this.ports.directory?.accessRuleCounts() ?? new Map<string, number>(),
      this.ports.directory?.accountNames([...new Set(maps.map((m) => m.ownerAccountId))]) ??
        new Map<string, string>(),
    ]);
    return maps.map((m) => ({
      id: m.id,
      slug: m.slug,
      name: m.name,
      ...(m.kind ? { kind: m.kind } : {}),
      description: m.description ?? '',
      ownerAccountId: m.ownerAccountId,
      ownerName: names.get(m.ownerAccountId) ?? null,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      deletedAt: m.deletedAt ?? null,
      systems: systems.get(m.id) ?? 0,
      rules: rules.get(m.id) ?? 0,
    }));
  }

  /** An instance admin deletes a map (softly, like its admins do). */
  async adminTrash(actor: Actor | null, mapId: string): Promise<void> {
    const admin = requireInstanceRole(actor, 'admin');
    await this.trashAs(admin, mapId);
  }

  /** An instance admin brings a deleted map back as it was. */
  async restore(actor: Actor | null, mapId: string): Promise<ChainMap> {
    const admin = requireInstanceRole(actor, 'admin');
    return this.write(admin, mapId, async (events) => {
      const current = await this.load(mapId);
      if (!current.deletedAt) throw new ConflictError('The map is not deleted');
      // The address stayed reserved while it was deleted, so it is still free.
      const { deletedAt: _gone, ...rest } = current;
      const next: ChainMap = { ...rest, updatedAt: this.ports.clock.now() };
      await this.ports.maps.update(next);
      events.add('map.restored', next, current);
      return next;
    });
  }

  /** An instance admin removes a deleted map and everything on it for good. */
  async purge(actor: Actor | null, mapId: string): Promise<void> {
    const admin = requireInstanceRole(actor, 'admin');
    await this.write(admin, mapId, async (events) => {
      const current = await this.load(mapId);
      if (!current.deletedAt) throw new ConflictError('Delete the map first; only deleted maps are purged');
      await this.ports.maps.delete(mapId);
      events.add('map.removed', { id: mapId }, current);
    });
  }

  private async trashAs(who: Actor, mapId: string): Promise<void> {
    await this.write(who, mapId, async (events) => {
      const current = await this.load(mapId);
      if (current.deletedAt) return;
      const deletedAt = this.ports.clock.now();
      await this.ports.maps.update({ ...current, deletedAt, updatedAt: deletedAt });
      events.add('map.trashed', { id: mapId, deletedAt }, current);
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
