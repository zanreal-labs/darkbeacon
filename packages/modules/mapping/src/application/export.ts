import {
  ConflictError,
  ForbiddenError,
  newId,
  NotFoundError,
  requireAccount,
  type Actor,
} from '@darkbeacon/core';
import {
  MAP_EXPORT_FORMAT,
  MAP_EXPORT_VERSION,
  MAP_SETTINGS_EXPORT_FORMAT,
  type DuplicateMapRequest,
  type MapExportDocument,
  type MapSettingsExportDocument,
} from '@darkbeacon/shared';
import type { ChainMap, Comment, Connection, MapSystem, Signature, Structure } from '../domain/map.js';
import { MappingUseCases } from './base.js';
import { MapUseCases } from './maps.js';

/** The map part of an export: everything but the access rules (those belong to access). */
export type MapContentExport = Omit<MapExportDocument, 'accessRules'>;

export interface ImportedMap {
  map: ChainMap;
  systems: number;
  connections: number;
  signatures: number;
  structures: number;
  comments: number;
  skippedSystems: number[];
}

/**
 * Darkbeacon's own map files: export a map with everything on it, make a new map from a file,
 * duplicate a map, and carry settings between maps. Files are `MapExportDocument` v1 (see
 * `@darkbeacon/shared`); access rules are added and applied by the access module.
 */
export class MapTransfer extends MappingUseCases {
  /** Everything on the map, hidden systems and their intel included (managers and up). */
  async exportMap(
    actor: Actor | null,
    mapId: string,
    options: { instance?: string | null } = {},
  ): Promise<MapContentExport> {
    await this.authorize(actor, mapId, 'manager');
    return this.read(mapId, options.instance ?? null);
  }

  /**
   * A new map from a file, owned by the caller (who may create maps). Systems the universe does
   * not know are left out with what hangs on them; connections and signatures get new ids.
   */
  async importMap(
    actor: Actor | null,
    document: MapContentExport,
    options: { name?: string | undefined; slug?: string | undefined } = {},
  ): Promise<ImportedMap> {
    const account = requireAccount(actor);
    if (this.ports.directory && !(await this.ports.directory.mayCreateMaps(account)))
      throw new ForbiddenError('Only instance admins create maps on this instance');
    if (document.format !== MAP_EXPORT_FORMAT || document.version !== MAP_EXPORT_VERSION)
      throw new ConflictError('Not a Darkbeacon map file this version can read');
    const now = this.ports.clock.now();
    const slug = options.slug ?? (await this.availableSlug(document.map.slug));
    const labels = new Set(document.map.labels.map((l) => l.id));
    const systemLabels = new Set(document.map.systemLabels.map((l) => l.id));
    const map: ChainMap = {
      id: newId(),
      slug,
      name: options.name ?? document.map.name,
      ...(document.map.kind === 'composite' ? { kind: 'composite' as const } : {}),
      ...(document.map.description ? { description: document.map.description } : {}),
      ownerAccountId: account.id,
      settings: document.map.settings,
      labels: document.map.labels,
      systemLabels: document.map.systemLabels,
      ...(document.map.views?.length ? { views: document.map.views } : {}),
      createdAt: now,
      updatedAt: now,
    };
    return this.write(account, map.id, async (events) => {
      if (await this.ports.maps.findBySlug(slug)) throw new ConflictError(`The address ${slug} is taken`);
      await this.ports.maps.insert(map);
      events.add('map.created', map);

      const skippedSystems: number[] = [];
      const placed = new Map<number, MapSystem>();
      for (const s of document.systems) {
        if (!this.ports.universe.getSystem(s.solarSystemId) || placed.has(s.solarSystemId)) {
          if (!placed.has(s.solarSystemId)) skippedSystems.push(s.solarSystemId);
          continue;
        }
        const system: MapSystem = {
          ...s,
          mapId: map.id,
          labelIds: s.labelIds.filter((id) => labels.has(id)),
          systemLabelIds: (s.systemLabelIds ?? []).filter((id) => systemLabels.has(id)),
          createdAt: now,
          updatedAt: now,
        };
        await this.ports.systems.insert(system);
        placed.set(system.solarSystemId, system);
        if (system.visible) events.add('system.added', system);
      }

      const connectionIds = new Map<string, string>();
      for (const c of document.connections) {
        const ends = [placed.get(c.source), placed.get(c.target)];
        // Hidden systems have no connections on a map; a file that says otherwise is not followed.
        if (!ends.every((s) => s?.visible) || c.source === c.target) continue;
        const connection: Connection = { ...c, id: newId(), mapId: map.id, createdAt: now, updatedAt: now };
        if (!(await this.ports.connections.insert(connection))) continue; // the pair twice in the file
        connectionIds.set(c.id, connection.id);
        events.add('connection.added', connection);
      }

      let signatures = 0;
      const codes = new Set<string>();
      for (const s of document.signatures) {
        const system = placed.get(s.solarSystemId);
        const code = `${s.solarSystemId}:${s.eveId}`;
        if (!system || codes.has(code)) continue;
        codes.add(code);
        const signature: Signature = {
          ...s,
          id: newId(),
          mapId: map.id,
          connectionId: s.connectionId ? (connectionIds.get(s.connectionId) ?? null) : null,
          createdAt: now,
          updatedAt: now,
        };
        await this.ports.signatures.insert(signature);
        signatures++;
        if (system.visible) events.add('signature.added', signature);
      }

      // Structures and comments keep their authors and dates: they are what was known then.
      let structures = 0;
      const structureRepository = this.ports.structures;
      if (structureRepository) {
        for (const s of document.structures ?? []) {
          const system = placed.get(s.solarSystemId);
          if (!system) continue;
          const structure: Structure = { ...s, id: newId(), mapId: map.id };
          await structureRepository.insert(structure);
          structures++;
          if (system.visible) events.add('structure.added', structure);
        }
      }
      let comments = 0;
      const commentRepository = this.ports.comments;
      if (commentRepository) {
        for (const c of document.comments ?? []) {
          const system = placed.get(c.solarSystemId);
          if (!system) continue;
          const comment: Comment = { ...c, id: newId(), mapId: map.id };
          await commentRepository.insert(comment);
          comments++;
          if (system.visible) events.add('comment.added', comment);
        }
      }
      return {
        map,
        systems: placed.size,
        connections: connectionIds.size,
        signatures,
        structures,
        comments,
        skippedSystems,
      };
    });
  }

  /**
   * A copy of the map as a new one owned by the caller: systems (hidden ones and their intel too),
   * connections, settings and labels, and signatures, structures and comments unless left out
   * (map admins). The rules are copied by the access module.
   */
  async duplicate(actor: Actor | null, mapId: string, request: DuplicateMapRequest): Promise<ImportedMap> {
    await this.authorize(actor, mapId, 'admin');
    const document = await this.read(mapId, null);
    return this.importMap(
      actor,
      request.signatures ? document : { ...document, signatures: [], structures: [], comments: [] },
      {
        name: request.name,
        slug: request.slug,
      },
    );
  }

  /** The map's settings and labels as a file (managers and up). */
  async exportSettings(actor: Actor | null, mapId: string): Promise<MapSettingsExportDocument> {
    await this.authorize(actor, mapId, 'manager');
    const map = await this.load(mapId);
    return {
      format: MAP_SETTINGS_EXPORT_FORMAT,
      version: 1,
      exportedAt: this.ports.clock.now(),
      settings: map.settings,
      labels: map.labels,
      systemLabels: map.systemLabels,
      ...(map.views?.length ? { views: map.views } : {}),
    };
  }

  /** Applies a settings file to the map (admins): settings, and the label list unless left out. */
  async importSettings(
    actor: Actor | null,
    mapId: string,
    document: MapSettingsExportDocument,
    withLabels: boolean,
  ): Promise<ChainMap> {
    const who = await this.authorize(actor, mapId, 'admin');
    const maps = new MapUseCases(this.ports);
    return this.ports.uow.transaction(async () => {
      const updated = await maps.update(who, mapId, { settings: document.settings });
      if (!withLabels) return updated;
      await maps.setLabels(who, mapId, document.labels);
      await maps.setSystemLabels(who, mapId, document.systemLabels);
      if (document.views) await maps.setViews(who, mapId, document.views);
      return this.load(mapId);
    });
  }

  private async read(mapId: string, instance: string | null): Promise<MapContentExport> {
    const map = await this.load(mapId);
    const [systems, connections, signatures, structures, comments] = await Promise.all([
      this.ports.systems.list(mapId),
      this.ports.connections.list(mapId),
      this.ports.signatures.listForMap(mapId),
      this.ports.structures?.listForMap(mapId) ?? ([] as Structure[]),
      this.ports.comments?.listForMap(mapId) ?? ([] as Comment[]),
    ]);
    const strip = <T extends { mapId: string; provenance?: unknown }>({
      mapId: _m,
      provenance: _p,
      ...rest
    }: T) => rest;
    return {
      format: MAP_EXPORT_FORMAT,
      version: MAP_EXPORT_VERSION,
      exportedAt: this.ports.clock.now(),
      source: { instance, mapId: map.id, slug: map.slug },
      map: {
        name: map.name,
        slug: map.slug,
        description: map.description ?? '',
        ...(map.kind ? { kind: map.kind } : {}),
        settings: map.settings,
        labels: map.labels,
        systemLabels: map.systemLabels,
        ...(map.views?.length ? { views: map.views } : {}),
      },
      systems: systems.map(strip),
      connections: connections.map(strip),
      signatures: signatures.map(strip),
      structures: structures.map(strip),
      comments: comments.map(strip),
    };
  }

  private async load(mapId: string): Promise<ChainMap> {
    const map = await this.ports.maps.findById(mapId);
    if (!map || map.deletedAt) throw new NotFoundError('Map');
    return map;
  }

  /** `base`, or `base-2`, `base-3`... whichever is free first. */
  private async availableSlug(base: string): Promise<string> {
    for (let n = 1; ; n++) {
      const slug = n === 1 ? base : `${base.slice(0, 44)}-${n}`;
      if (!(await this.ports.maps.findBySlug(slug))) return slug;
    }
  }
}
