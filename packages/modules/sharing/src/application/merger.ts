import {
  mapStream,
  newEvent,
  actorRef,
  type Actor,
  type AuditContext,
  type NewEvent,
} from '@darkbeacon/core';
import {
  LOCAL_INSTANCE,
  type ChainEntry,
  type ChainOrigin,
  type MapSourceDto,
  type PassageDto,
  type Position,
} from '@darkbeacon/shared';
import type { FeedSelector } from '../domain/feed.js';
import { pairKey, parseRefId, refId, sameOrigin } from '../domain/keys.js';
import { mergePassages, passagesShared, type ChainPassage } from '../domain/passages.js';
import {
  asPosition,
  besideNeighbour,
  clusterOffset,
  extentOf,
  layoutLinks,
  placeFree,
  placedAsSourceHasIt,
  shifted,
} from '../domain/layout.js';
import { ChainMerge } from '../domain/merge.js';
import { shareScopes, type Share } from '../domain/shares.js';
import {
  entitiesOf,
  SELF,
  sourceDto,
  ViewState,
  type SourceInfo,
  type ViewChange,
  type ViewContext,
  type ViewEntity,
} from '../domain/view.js';
import type { ChainMapInfo, ChainSelector, LocalFields } from '../ports/index.js';
import { SHARING_ACTOR, SHARING_COPY_ACTOR, type SharingPorts } from './ports.js';

/** A merged map in memory: its sources, their merge and what its viewers were given. */
interface MergedMap {
  mapId: string;
  info: ChainMapInfo;
  /** Every source, hidden ones included (what the snapshot lists). */
  sources: SourceInfo[];
  merge: ChainMerge;
  view: ViewState;
  layout: Map<number, Position>;
  /** How far each source's own coordinates are shifted on the layout (fixed once, by source id). */
  offsets: Map<string, Position>;
  /** A composite's own notes, labels and locks of systems. */
  local: Map<number, LocalFields>;
}

/** What placing systems decided: new positions, and the offsets sources got for the first time. */
interface Placing {
  layout: Map<number, Position>;
  placed: Array<{ solarSystemId: number; position: Position }>;
  offsets: Map<string, Position>;
  newOffsets: Array<{ sourceId: string; offset: Position }>;
}

/** The systems, connections and signatures a merged map shows (mapping's ChainOverlay). */
export interface MergedChain {
  systems: Extract<ViewEntity, { kind: 'system' }>['dto'][];
  connections: Extract<ViewEntity, { kind: 'connection' }>['dto'][];
  signatures: Extract<ViewEntity, { kind: 'signature' }>['dto'][];
}

const local = (mapId: string): ChainOrigin => ({ instance: LOCAL_INSTANCE, mapId });

/**
 * Keeps every merged map's view up to date. A merged map (a composite, or a map with accepted
 * shares) merges its own objects (`self`) and its sources; whenever a source changes, the
 * touched objects are read again from it, merged incrementally and the difference to what the
 * map's viewers have is published on the map's own stream (own seq, so replay and snapshots work
 * as for any map) and stored with it. Work on one map runs one at a time; a burst of changes is
 * merged in one pass.
 */
export class ChainMerger {
  private readonly maps = new Map<string, MergedMap>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly pending = new Map<string, Map<string, FeedSelector[]>>();
  private shares: Share[] | null = null;

  constructor(private readonly ports: SharingPorts) {}

  // --- reading --------------------------------------------------------------------------------

  /** The merged chain of a map as its viewers have it, or null when it merges nothing. */
  async chain(mapId: string): Promise<MergedChain | null> {
    const { views } = this.ports;
    const stored = await views.load(mapId);
    if (stored.sources === null) return null;
    const out: MergedChain = { systems: [], connections: [], signatures: [] };
    for (const e of stored.entities) {
      if (e.kind === 'system') out.systems.push(e.dto);
      else if (e.kind === 'connection') out.connections.push(e.dto);
      else if (e.kind === 'signature') out.signatures.push(e.dto);
    }
    return out;
  }

  /** The snapshot part of a merged map: its sources and the merged characters. Empty for plain maps. */
  async snapshot(mapId: string): Promise<Record<string, unknown>> {
    const stored = await this.ports.views.load(mapId);
    if (stored.sources === null) return {};
    return {
      sources: stored.sources,
      characters: stored.entities.filter((e) => e.kind === 'character').map((e) => e.dto),
    };
  }

  /**
   * Passages of a merged connection: read from every visible source holding the hole that shares
   * its status (each cuts them to its scopes), a jump two sources recorded counted once. The
   * map's own passages keep their ids; the others are read-only here and say where they live.
   */
  async passages(
    mapId: string,
    connection: { id: string; source: number; target: number },
  ): Promise<PassageDto[]> {
    const map = await this.state(mapId);
    if (!map) return [];
    const pair = pairKey(connection.source, connection.target);
    const holding = new Set(map.merge.holders(refId('connection', pair)));
    const perSource: Array<Array<{ passage: ChainPassage; source: SourceInfo }>> = [];
    for (const source of map.sources) {
      if (source.hidden || !holding.has(source.id) || !passagesShared(source.scopes)) continue;
      const adapter = this.ports.sources.source(source.origin);
      if (!adapter) continue;
      const found = await adapter.passages(pair, source.scopes);
      perSource.push(found.map((passage) => ({ passage, source })));
    }
    return mergePassages(perSource).map(({ passage: p, source }) => ({
      id: p.id && source.id === SELF ? p.id : `m:${source.id}:${p.key}`,
      connectionId: connection.id,
      characterId: p.pilot?.id ?? null,
      characterName: p.pilot?.name ?? null,
      shipTypeId: p.shipTypeId,
      mass: p.mass,
      from: p.from,
      to: p.to,
      occurredAt: p.at,
      source: p.source,
      massMode: p.massMode,
      higgs: p.higgs,
      entangler: p.entangler,
      note: p.note,
      recordedOn: source.id === SELF ? null : source.name,
    }));
  }

  /** True when the map merges other maps (as stored, i.e. what its viewers see). */
  async isMerged(mapId: string): Promise<boolean> {
    return (await this.ports.views.load(mapId)).sources !== null;
  }

  /** The in-memory state of a merged map (built when missing); null for plain maps. */
  async state(mapId: string): Promise<Readonly<MergedMap> | null> {
    return this.serial(mapId, () => this.ensure(mapId));
  }

  /** Maps that merge `origin`, with the share (or `self`) it reaches them through. */
  async targetsOf(origin: ChainOrigin): Promise<Array<{ mapId: string; sourceId: string }>> {
    const out: Array<{ mapId: string; sourceId: string }> = [];
    for (const share of await this.activeShares()) {
      if (share.hidden || !sameOrigin(share.source, origin) || share.target.instance !== LOCAL_INSTANCE)
        continue;
      out.push({ mapId: share.target.mapId, sourceId: share.id });
    }
    if (
      origin.instance === LOCAL_INSTANCE &&
      (this.maps.has(origin.mapId) || (await this.isMerged(origin.mapId)))
    )
      out.push({ mapId: origin.mapId, sourceId: SELF });
    return out;
  }

  // --- changes --------------------------------------------------------------------------------

  /**
   * A source changed: what to read again from it. Coalesced per merged map and source; resolves
   * when every map merging it is up to date.
   */
  async sourceChanged(origin: ChainOrigin, selectors: readonly FeedSelector[]): Promise<void> {
    const targets = await this.targetsOf(origin);
    await Promise.all(
      targets.map(({ mapId, sourceId }) => {
        let bySource = this.pending.get(mapId);
        if (!bySource) this.pending.set(mapId, (bySource = new Map()));
        bySource.set(sourceId, [...(bySource.get(sourceId) ?? []), ...selectors]);
        return this.serial(mapId, () => this.flush(mapId));
      }),
    );
  }

  /** Shares of the map changed (or the map itself): merges it again from scratch. */
  async rebuild(mapId: string): Promise<void> {
    this.shares = null;
    await this.serial(mapId, () => this.build(mapId));
  }

  /** A source map is gone or renamed: every map merging it, and the map itself, again. */
  async mapChanged(mapId: string): Promise<void> {
    this.shares = null;
    const targets = new Set([mapId]);
    for (const share of await this.activeShares()) {
      if (sameOrigin(share.source, local(mapId)) && share.target.instance === LOCAL_INSTANCE)
        targets.add(share.target.mapId);
    }
    await Promise.all([...targets].map((id) => this.rebuild(id)));
  }

  /** Builds every merged map (startup): composites, targets of shares and maps with a stored view. */
  async rebuildAll(): Promise<void> {
    this.shares = null;
    const ids = new Set<string>([
      ...(await this.ports.composites.listComposites()),
      ...(await this.ports.views.mapsWithView()),
      ...(await this.activeShares())
        .filter((s) => s.target.instance === LOCAL_INSTANCE)
        .map((s) => s.target.mapId),
    ]);
    for (const id of ids) await this.rebuild(id);
  }

  /** Places systems on a merged map's own layout (a viewer dragged them). */
  async move(
    actor: Actor,
    mapId: string,
    positions: ReadonlyArray<{ solarSystemId: number; position: Position }>,
  ): Promise<void> {
    await this.serial(mapId, async () => {
      const map = await this.ensure(mapId);
      if (!map) return;
      const changed = positions.filter(({ solarSystemId, position }) => {
        const at = map.layout.get(solarSystemId);
        return !at || at.x !== position.x || at.y !== position.y;
      });
      if (changed.length === 0) return;
      const refs = new Set(changed.map((p) => refId('system', String(p.solarSystemId))));
      const placing = this.placing(map);
      for (const { solarSystemId, position } of changed) placing.layout.set(solarSystemId, position);
      placing.placed.push(...changed);
      await this.publish(map, refs, actor, {}, { placing });
    });
  }

  /**
   * A composite's own notes, label assignments and lock of a system: kept on the composite, over
   * what its sources say, and published like any change of the map.
   */
  async setLocal(
    actor: Actor,
    mapId: string,
    solarSystemId: number,
    patch: Partial<LocalFields>,
  ): Promise<void> {
    await this.serial(mapId, async () => {
      const map = await this.ensure(mapId);
      if (!map) return;
      const current = map.local.get(solarSystemId) ?? { notes: null, labelIds: [], locked: false };
      const next: LocalFields = { ...current, ...patch };
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      const local = new Map(map.local).set(solarSystemId, next);
      await this.publish(
        map,
        new Set([refId('system', String(solarSystemId))]),
        actor,
        {},
        {
          local,
          localChanged: { solarSystemId, fields: next },
        },
      );
    });
  }

  /**
   * Forgets what is kept of one map, and the shares (another process merged it, or changed
   * them); the next use builds it again from what is stored.
   */
  forget(mapId: string): void {
    this.maps.delete(mapId);
    this.shares = null;
  }

  /** Forgets everything kept in memory (the database was replaced); the next use builds again. */
  reset(): void {
    this.maps.clear();
    this.pending.clear();
    this.shares = null;
  }

  /** Resolves once nothing is queued for any merged map. */
  async idle(): Promise<void> {
    while (this.queues.size > 0) await Promise.all([...this.queues.values()]);
  }

  /** Runs `work` after everything already queued for the map. */
  private serial<T>(mapId: string, work: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(mapId) ?? Promise.resolve()).then(work, work);
    const settled = run.catch(() => undefined);
    this.queues.set(mapId, settled);
    void settled.then(() => {
      if (this.queues.get(mapId) === settled) this.queues.delete(mapId);
    });
    return run;
  }

  private async activeShares(): Promise<Share[]> {
    this.shares ??= await this.ports.shares.listActive();
    return this.shares;
  }

  /** The state of a merged map, built when it is not in memory yet; null for plain maps. */
  private async ensure(mapId: string): Promise<MergedMap | null> {
    const known = this.maps.get(mapId);
    if (known) return known;
    await this.build(mapId);
    return this.maps.get(mapId) ?? null;
  }

  private async flush(mapId: string): Promise<void> {
    const bySource = this.pending.get(mapId);
    this.pending.delete(mapId);
    if (!bySource || bySource.size === 0) return;
    const map = await this.ensure(mapId);
    if (!map) return;
    try {
      await this.flushSources(map, bySource);
    } catch (error) {
      // Memory may be ahead of what was stored: the next use builds the map again from scratch.
      this.maps.delete(mapId);
      throw error;
    }
  }

  private async flushSources(map: MergedMap, bySource: Map<string, FeedSelector[]>): Promise<void> {
    for (const [sourceId, selectors] of bySource) {
      const source = map.sources.find((s) => s.id === sourceId);
      if (!source || source.hidden || !map.merge.hasSource(sourceId)) continue;
      const adapter = this.ports.sources.source(source.origin);
      if (!adapter) continue;
      // Kind selectors also cover what the merge holds from the source, so gone objects are found.
      const exact = new Set<string>();
      for (const s of selectors) {
        if ('key' in s) exact.add(refId(s.kind, s.key));
        else {
          const system = 'solarSystemId' in s ? s.solarSystemId : undefined;
          for (const ref of map.merge.held(sourceId, s.kind, system)) exact.add(ref);
        }
      }
      const request: ChainSelector[] = [
        ...[...exact].map((ref) => parseRefId(ref)),
        ...selectors.filter((s) => 'all' in s),
      ];
      const delta = await adapter.read(source.scopes, request);
      const answered = new Set(delta.entries.map((e) => refId(e.kind, e.key)));
      const entries: ChainEntry[] = [...delta.entries];
      for (const ref of exact) {
        if (answered.has(ref)) continue;
        const { kind, key } = parseRefId(ref);
        entries.push({ kind, key, state: 'absent' });
      }
      const touched = map.merge.apply(sourceId, entries);
      const mergedFrom =
        sourceId === SELF
          ? {}
          : {
              mergedFrom: { instance: source.origin.instance, mapId: source.origin.mapId, name: source.name },
            };
      await this.publish(map, touched, SHARING_ACTOR, mergedFrom);
    }
  }

  /**
   * Merges the map from scratch: its sources as they are now, against what its viewers were
   * given. Also takes a map out of merging (its viewers go back to its own objects).
   */
  private async build(mapId: string): Promise<void> {
    const { sources, views, layout, shares } = this.ports;
    const info = await sources.describe(local(mapId));
    if (!info) {
      this.maps.delete(mapId);
      await this.ports.uow.transaction(async () => {
        await views.clear(mapId);
        await layout.clear(mapId);
        await this.ports.local.clear(mapId);
      });
      return;
    }
    const incoming = await shares.listActiveForTarget(local(mapId));
    const stored = await views.load(mapId);
    const merging = info.kind === 'composite' || incoming.length > 0;
    if (!merging && stored.sources === null) {
      this.maps.delete(mapId);
      return;
    }

    const list: SourceInfo[] = [
      {
        id: SELF,
        origin: local(mapId),
        name: info.name,
        instanceName: null,
        level: 'read-write',
        scopes: 'all',
        hidden: false,
      },
    ];
    if (merging) {
      for (const share of incoming) {
        const described = await sources.describe(share.source);
        if (!described) continue;
        list.push({
          id: share.id,
          origin: share.source,
          name: described.name,
          instanceName: described.instanceName,
          level: share.level,
          scopes: shareScopes(share),
          hidden: share.hidden,
          defaultWrite: share.defaultWrite,
        });
      }
    }

    const merge = new ChainMerge();
    let order = 0;
    for (const source of list) {
      if (source.hidden) continue;
      const adapter = sources.source(source.origin);
      if (!adapter) continue;
      merge.setSource(source.id, order++);
      const delta = await adapter.read(source.scopes);
      merge.apply(source.id, delta.entries, true);
    }
    const map: MergedMap = {
      mapId,
      info,
      sources: list,
      merge,
      view: new ViewState(stored.entities),
      layout: await layout.list(mapId),
      offsets: await layout.offsets(mapId),
      local: info.kind === 'composite' ? await this.ports.local.list(mapId) : new Map(),
    };
    const refs = new Set([...merge.refs(), ...map.view.refs()]);
    const nextSources = list.map(sourceDto);
    const sourcesChanged = JSON.stringify(stored.sources) !== JSON.stringify(merging ? nextSources : null);
    const placing = this.placing(map);
    // A map laid out before sources had offsets: their clusters move beside each other once.
    if (merging && map.offsets.size === 0 && map.layout.size > 0) this.separateClusters(map, placing);
    await this.publish(
      map,
      refs,
      SHARING_ACTOR,
      {},
      {
        sources: merging ? nextSources : [],
        sourcesChanged,
        placing,
      },
    );
    if (merging) this.maps.set(mapId, map);
    else {
      // Its viewers now have the map's own objects again: back to a plain map.
      this.maps.delete(mapId);
      await this.ports.uow.transaction(async () => {
        await views.clear(mapId);
        await layout.clear(mapId);
      });
    }
  }

  /**
   * Recomputes the view entities of `refs`, places new systems, and publishes the difference as
   * events on the map's stream in one transaction with the stored view; memory follows the commit.
   */
  private async publish(
    map: MergedMap,
    refs: Set<string>,
    actor: Actor,
    audit: AuditContext,
    extra: {
      /** Positions already decided (a drag, clusters moved apart); new systems are placed on top. */
      placing?: Placing;
      sources?: MapSourceDto[];
      sourcesChanged?: boolean;
      local?: Map<number, LocalFields>;
      localChanged?: { solarSystemId: number; fields: LocalFields };
    } = {},
  ): Promise<void> {
    // On a map with objects of its own, the merge's events are copies (webhooks and plugins skip them).
    const merge = actor === SHARING_ACTOR;
    if (merge && map.info.kind !== 'composite') actor = SHARING_COPY_ACTOR;
    const local = extra.local ?? map.local;
    const placing = extra.placing ?? this.placing(map);
    this.place(map, refs, placing);
    const { layout, placed, offsets, newOffsets } = placing;
    const ctx: ViewContext = {
      mapId: map.mapId,
      sources: new Map(map.sources.filter((s) => !s.hidden).map((s) => [s.id, s])),
      layout,
      local,
      ...(map.info.systemLabels ? { systemLabels: map.info.systemLabels } : {}),
    };
    const next: ViewEntity[] = [];
    for (const ref of refs) next.push(...entitiesOf(map.merge, ref, ctx));
    const changes = map.view.diff(refs, next);
    if (
      changes.length === 0 &&
      placed.length === 0 &&
      newOffsets.length === 0 &&
      !extra.sourcesChanged &&
      !extra.localChanged
    ) {
      map.layout = layout;
      return;
    }

    const events = changes.map((change) => toEvent(map.mapId, change, actor, this.ports.clock.now()));
    if (extra.sourcesChanged) {
      events.push(
        newEvent({
          stream: mapStream(map.mapId),
          type: 'map.sources_changed',
          actor: actorRef(merge ? actor : SHARING_ACTOR),
          data: { sources: extra.sources ?? [] },
          occurredAt: this.ports.clock.now(),
        }),
      );
    }
    const { views, uow, events: log, audit: scope } = this.ports;
    // Merged changes are the merge's own doing, whatever request happened to trigger them.
    const context: AuditContext = merge
      ? {
          channel: { kind: 'system', id: 'sharing' },
          origin: undefined,
          characterId: undefined,
          via: undefined,
          ...audit,
        }
      : audit;
    await scope.run(context, () =>
      uow.transaction(async () => {
        const puts = changes.flatMap((c) => (c.after ? [c.after] : []));
        const removals = changes.flatMap((c) => (!c.after && c.before ? [c.before] : []));
        if (removals.length > 0) await views.remove(map.mapId, removals);
        if (puts.length > 0) await views.put(map.mapId, puts);
        if (placed.length > 0) await this.ports.layout.put(map.mapId, placed, this.ports.clock.now());
        if (newOffsets.length > 0)
          await this.ports.layout.putOffsets(map.mapId, newOffsets, this.ports.clock.now());
        if (extra.sources) await views.saveSources(map.mapId, extra.sources);
        if (extra.localChanged) {
          const { solarSystemId, fields } = extra.localChanged;
          await this.ports.local.put(map.mapId, solarSystemId, fields, this.ports.clock.now());
        }
        if (events.length > 0) await log.append(events);
      }),
    );
    map.view.apply(changes);
    map.layout = layout;
    map.offsets = offsets;
    map.local = local;
  }

  /** A draft of the map's layout to place systems on (committed with the publish). */
  private placing(map: MergedMap): Placing {
    return { layout: new Map(map.layout), placed: [], offsets: new Map(map.offsets), newOffsets: [] };
  }

  /**
   * Systems new to the map get a position on its own layout: next to a neighbour already placed,
   * at the offset their source has between them (the map's own systems keep their places that
   * way), else where their first source has them, shifted by that source's offset; when that spot
   * is taken, by the map placement rule (`placeFree`), never covering another system. Sources lay
   * themselves out in coordinate spaces of their own, so the first time a source needs room of its
   * own its cluster is shifted right of everything shown (the first one keeps its coordinates), and
   * the shift is kept so its later systems join it.
   */
  private place(map: MergedMap, refs: Set<string>, placing: Placing): void {
    const { layout, placed, offsets, newOffsets } = placing;
    const order = new Map(map.merge.sourceIds().map((id, i) => [id, i]));
    const pending: Array<{ id: number; ref: string; holders: string[]; order: number }> = [];
    for (const ref of refs) {
      const { kind, key } = parseRefId(ref);
      if (kind !== 'system') continue;
      const id = Number(key);
      if (layout.has(id)) continue;
      // Only shown systems: hidden copies never show (and are thousands on an intel library).
      const holders = map.merge.holders(ref);
      if (holders.length === 0) continue;
      pending.push({ id, ref, holders, order: order.get(holders[0]!) ?? 0 });
    }
    if (pending.length === 0) return;
    // The map's own systems first, then by source, then by id.
    pending.sort((a, b) => a.order - b.order || a.id - b.id);
    const own = (source: string, ref: string) => asPosition(map.merge.sourceField(source, ref, 'pos'));
    const put = (id: number, spot: Position | null, near: number | null = null) => {
      const links = layoutLinks(layout, (n) => map.merge.neighbours(n));
      const position = placeFree(spot, layout, links, near);
      layout.set(id, position);
      placed.push({ solarSystemId: id, position });
    };
    const offsetOf = (source: string): Position => {
      const known = offsets.get(source);
      if (known) return known;
      // Its cluster: what of it is waiting for a place now.
      const cluster = extentOf(
        pending.flatMap((item) => (item.holders[0] === source ? (own(source, item.ref) ?? []) : [])),
      );
      const offset = clusterOffset(cluster, extentOf(shownOn(map, layout).map(([, at]) => at)));
      offsets.set(source, offset);
      newOffsets.push({ sourceId: source, offset });
      return offset;
    };
    const beside = (item: (typeof pending)[number]): { spot: Position; near: number } | null => {
      for (const source of item.holders) {
        const at = own(source, item.ref);
        if (!at) continue;
        for (const neighbour of map.merge.neighbours(item.id)) {
          const placedAt = layout.get(neighbour);
          const there = own(source, refId('system', String(neighbour)));
          if (placedAt && there) return { spot: besideNeighbour(at, there, placedAt), near: neighbour };
        }
      }
      return null;
    };
    while (pending.length > 0) {
      let progressed = false;
      for (const item of [...pending]) {
        const next = beside(item);
        if (!next) continue;
        put(item.id, next.spot, next.near);
        pending.splice(pending.indexOf(item), 1);
        progressed = true;
      }
      if (progressed) continue;
      // Nothing next to a placed neighbour: the first one goes where its first source has it,
      // in that source's cluster (a system several sources hold: the first one's).
      const first = pending[0]!;
      const source = first.holders[0]!;
      const at = own(source, first.ref);
      const spot = at ? shifted(at, offsetOf(source)) : null;
      pending.shift();
      put(first.id, spot);
    }
  }

  /**
   * Once for a map laid out before sources had offsets (every source's systems where that
   * source has them, so clusters of different coordinate spaces lie apart or on top of each
   * other): the first source with systems keeps its coordinates, and each other source's systems
   * that still sit where it has them (not moved since, nor placed beside another source's) move
   * as one cluster right of what is placed, as new sources' clusters do. Moved systems stay.
   */
  private separateClusters(map: MergedMap, placing: Placing): void {
    const { layout, placed, offsets, newOffsets } = placing;
    // Placed systems by the source they were placed from (their first holder), unmoved ones only.
    const bySource = new Map<string, Array<{ id: number; at: Position }>>();
    for (const [id, at] of layout) {
      const ref = refId('system', String(id));
      const [first] = map.merge.holders(ref);
      const own = first ? asPosition(map.merge.sourceField(first, ref, 'pos')) : null;
      if (!first || !own) continue;
      const list = bySource.get(first) ?? [];
      if (placedAsSourceHasIt(at, own)) list.push({ id, at });
      bySource.set(first, list);
    }
    const [primary, ...others] = map.merge.sourceIds().filter((id) => bySource.has(id));
    if (!primary) return;
    const moving = new Set(others.flatMap((id) => bySource.get(id)!.map((s) => s.id)));
    const fixed = shownOn(map, layout).flatMap(([id, at]) => (moving.has(id) ? [] : [at]));
    const record = (sourceId: string, offset: Position) => {
      offsets.set(sourceId, offset);
      newOffsets.push({ sourceId, offset });
    };
    record(primary, { x: 0, y: 0 });
    for (const sourceId of others) {
      const cluster = bySource.get(sourceId)!;
      // Everything of it was moved or placed beside other sources: its offset comes when needed.
      if (cluster.length === 0) continue;
      const offset = clusterOffset(extentOf(cluster.map((s) => s.at)), extentOf(fixed));
      record(sourceId, offset);
      for (const { id, at } of cluster) {
        const position = shifted(at, offset);
        layout.set(id, position);
        placed.push({ solarSystemId: id, position });
        fixed.push(position);
      }
    }
  }
}

/** Positions of the systems the map shows (the layout also keeps places of systems gone for now). */
function shownOn(map: MergedMap, layout: ReadonlyMap<number, Position>): Array<[number, Position]> {
  return [...layout].filter(([id]) => map.merge.shows(refId('system', String(id))));
}

/** The event that brings viewers from `before` to `after` of one entity. */
function toEvent(mapId: string, change: ViewChange, actor: Actor, now: number): NewEvent {
  const { before, after } = change;
  const base = { stream: mapStream(mapId), actor: actorRef(actor), occurredAt: now };
  const entity = (after ?? before)!;
  if (!after) {
    const dto = before!.dto as unknown as Record<string, unknown>;
    switch (entity.kind) {
      case 'system':
        return newEvent({
          ...base,
          type: 'system.removed',
          data: { solarSystemId: dto.solarSystemId },
          before: dto,
        });
      case 'connection':
        return newEvent({ ...base, type: 'connection.removed', data: { id: dto.id }, before: dto });
      case 'signature':
        return newEvent({
          ...base,
          type: 'signature.removed',
          data: { id: dto.id, solarSystemId: dto.solarSystemId },
          before: dto,
        });
      case 'character':
        return newEvent({
          ...base,
          type: 'character.untracked',
          data: { characterId: dto.characterId },
          before: dto,
        });
    }
  }
  const prior = before ? { before: before.dto } : {};
  switch (entity.kind) {
    case 'system':
      return newEvent({
        ...base,
        type: before ? 'system.updated' : 'system.added',
        data: after.dto,
        ...prior,
      });
    case 'connection':
      return newEvent({
        ...base,
        type: before ? 'connection.updated' : 'connection.added',
        data: after.dto,
        ...prior,
      });
    case 'signature':
      return newEvent({
        ...base,
        type: before ? 'signature.updated' : 'signature.added',
        data: after.dto,
        ...prior,
      });
    case 'character':
      return newEvent({ ...base, type: 'character.tracked', data: after.dto, ...prior });
  }
}
