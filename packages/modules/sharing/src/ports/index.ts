import type { Actor, AuditMapRef } from '@darkbeacon/core';
import type {
  ChainDelta,
  ChainObjectKind,
  ChainOrigin,
  MapKind,
  Position,
  ShareScope,
} from '@darkbeacon/shared';
import type { ChainCommand } from '../domain/commands.js';
import type { ChainPassage } from '../domain/passages.js';
import type { Share } from '../domain/shares.js';
import type { ViewEntity, ViewKind } from '../domain/view.js';

export type { AuditScope, Clock, EventLog, MapAccess, UnitOfWork } from '@darkbeacon/core';

/**
 * What to read from a source: one object by key, or every object of a kind it holds (optionally
 * in one system).
 */
export type ChainSelector =
  { kind: ChainObjectKind; key: string } | { kind: ChainObjectKind; all: true; solarSystemId?: number };

/** Who writes through a merged map, and from which one (recorded as "via <map>" at the source). */
export interface ChainWriteContext {
  actor: Actor;
  /** Null when a map writes its own objects. */
  via: AuditMapRef | null;
  /** What the share lets the merged map see: the source refuses fields outside it. */
  scopes: readonly ShareScope[] | 'all';
}

/**
 * A map whose chain another map merges, wherever it lives: this instance (the local adapter over
 * mapping) or, later, another instance (an adapter over HTTPS/WebSocket). Everything crosses it in
 * the wire format of `ChainDelta` and `ChainCommand`: stable keys, stamped fields, tombstones, and
 * never more than `scopes` allow — the source cuts before anything leaves it.
 */
export interface ChainSource {
  readonly origin: ChainOrigin;
  /**
   * Objects of the source, cut to `scopes`: the whole chain when `selectors` is omitted
   * (`full: true`), else an entry for every selected key (`absent` or `deleted` when it has none)
   * plus everything a kind selector finds.
   */
  read(scopes: readonly ShareScope[] | 'all', selectors?: readonly ChainSelector[]): Promise<ChainDelta>;
  /**
   * Applies a change made through a merged map; throws when the source refuses it. Answers what
   * the change reports (a scanner paste's counts), else nothing.
   */
  write(command: ChainCommand, context: ChainWriteContext): Promise<unknown>;
  /**
   * Passages through the hole between a pair (`<low>-<high>`), newest first: none unless `scopes`
   * share connection status; pilots only with characters. Passages stay with the source.
   */
  passages(key: string, scopes: readonly ShareScope[] | 'all'): Promise<ChainPassage[]>;
}

/** The map behind an origin, by name: null when it is gone (or unreachable). */
export interface ChainMapInfo {
  origin: ChainOrigin;
  name: string;
  slug: string | null;
  kind: MapKind;
  /** Name of the instance it is on; null for this one. */
  instanceName: string | null;
}

/** Finds sources by origin. Only `local` origins exist today; remote instances plug in here later. */
export interface ChainSources {
  source(origin: ChainOrigin): ChainSource | null;
  describe(origin: ChainOrigin): Promise<ChainMapInfo | null>;
  /** A local map by its address (offering a share by slug). */
  findLocalBySlug(slug: string): Promise<ChainMapInfo | null>;
}

export interface ShareRepository {
  findById(id: string): Promise<Share | null>;
  /** Shares (offered and active) whose source or target is the map. */
  listForMap(origin: ChainOrigin): Promise<Share[]>;
  /** Active shares whose target is the map, oldest acceptance first. */
  listActiveForTarget(target: ChainOrigin): Promise<Share[]>;
  /** Every active share. */
  listActive(): Promise<Share[]>;
  insert(share: Share): Promise<void>;
  update(share: Share): Promise<void>;
  delete(id: string): Promise<void>;
  /** Removes every share the map is part of; returns them. */
  deleteForMap(origin: ChainOrigin): Promise<Share[]>;
}

/** The merged view a map's viewers have been given (what its derived events added up to). */
export interface StoredView {
  /** Null while the map does not merge anything. */
  sources: unknown[] | null;
  entities: ViewEntity[];
}

export interface ChainViewRepository {
  load(mapId: string): Promise<StoredView>;
  /** Kinds to read when only part of the view is needed (snapshots read everything). */
  loadKinds(mapId: string, kinds: readonly ViewKind[]): Promise<ViewEntity[]>;
  saveSources(mapId: string, sources: unknown[]): Promise<void>;
  put(mapId: string, entities: readonly ViewEntity[]): Promise<void>;
  remove(mapId: string, entities: ReadonlyArray<{ kind: ViewKind; id: string }>): Promise<void>;
  /** Forgets the view: the map does not merge anything any more. */
  clear(mapId: string): Promise<void>;
  /** Maps that have a stored view. */
  mapsWithView(): Promise<string[]>;
}

/** Where systems sit on a merged map: its own layout, never written back to sources. */
export interface ChainLayoutRepository {
  list(mapId: string): Promise<Map<number, Position>>;
  put(
    mapId: string,
    positions: ReadonlyArray<{ solarSystemId: number; position: Position }>,
    at: number,
  ): Promise<void>;
  clear(mapId: string): Promise<void>;
}

/** What a composite keeps of a system itself, over what its sources say. */
export interface LocalFields {
  /** Null: the merged notes show. */
  notes: string | null;
  labelIds: string[];
  locked: boolean;
}

export interface LocalFieldsRepository {
  list(mapId: string): Promise<Map<number, LocalFields>>;
  put(mapId: string, solarSystemId: number, fields: LocalFields, at: number): Promise<void>;
  clear(mapId: string): Promise<void>;
}

/** Local maps that are composites (merged by kind, with or without shares). */
export interface CompositeMaps {
  listComposites(): Promise<string[]>;
}
