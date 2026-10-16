import {
  actorRef,
  ConflictError,
  ForbiddenError,
  mapStream,
  newEvent,
  NotFoundError,
  requireAccount,
  requireMapRole,
  type Actor,
  type Clock,
  type EventLog,
  type MapAccess,
  type UnitOfWork,
} from '@darkbeacon/core';
import type { BridgeDto, ImportBridgesResultDto, PasteBridgesRequest } from '@darkbeacon/shared';
import {
  ANSIBLEX_RANGE_LY,
  EsiStructuresError,
  farSideOf,
  parseBridgeLines,
  type UnreadableLine,
} from '../domain/bridges.js';
import { isWormholeSpace } from '../domain/modes.js';
import type { RoutedEdge } from '../domain/options.js';
import type {
  AnsiblexStructure,
  BridgeRecord,
  BridgeRepository,
  CharacterStructureSearch,
  CorporationStructures,
  NewBridge,
  PilotDirectory,
  RouteEdgeSource,
  RoutingUniverse,
  SystemDistances,
} from '../ports/index.js';

export interface BridgeAdminDeps {
  bridges: BridgeRepository;
  universe: RoutingUniverse;
  structures: CorporationStructures;
  /** The Ansiblexes a character may use (the alliance's too); without it only the corporation's are read. */
  search?: CharacterStructureSearch;
  pilots: PilotDirectory;
  access: MapAccess;
  events: EventLog;
  uow: UnitOfWork;
  clock: Clock;
  newId(): string;
  /** Positions of known space, for the Ansiblex range; without them the range is not checked. */
  distances?: SystemDistances;
}

/** Unknown names reported back, at most. */
const UNKNOWN_SHOWN = 5;

/** System ids by lower-cased name, built once. */
export class SystemNames {
  private index: Map<string, number> | undefined;

  constructor(private readonly universe: RoutingUniverse) {}

  idOf(name: string): number | null {
    this.index ??= new Map([...this.universe.systems()].map((s) => [s.name.toLowerCase(), s.id]));
    return this.index.get(name.trim().toLowerCase()) ?? null;
  }
}

/**
 * A map's Ansiblex jump bridges: pasted from the in-game structure browser, found through ESI
 * (the gates a character may use and its corporation's), flagged dangerous or removed by its
 * managers; seen by everyone on the map. Every change is a `routes.bridges_changed` event.
 */
export class BridgeAdmin {
  private readonly names: SystemNames;

  constructor(private readonly deps: BridgeAdminDeps) {
    this.names = new SystemNames(deps.universe);
  }

  async list(actor: Actor | null, mapId: string): Promise<BridgeDto[]> {
    await requireMapRole(this.deps.access, actor, mapId, 'viewer');
    return this.sorted((await this.deps.bridges.list(mapId)).map((b) => this.dto(b)));
  }

  /** Reads pasted lines into bridges; known pairs are kept (the paste may flag them dangerous). */
  async paste(
    actor: Actor | null,
    mapId: string,
    request: PasteBridgesRequest,
  ): Promise<ImportBridgesResultDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'manager');
    const { pairs, unreadable } = parseBridgeLines(request.text, (name) => this.names.idOf(name) !== null);
    const unknown = new Set<string>();
    const bridges: NewBridge[] = [];
    for (const pair of pairs) {
      const a = this.names.idOf(pair.from);
      const b = this.names.idOf(pair.to);
      if (a === null) unknown.add(pair.from);
      if (b === null) unknown.add(pair.to);
      if (a === null || b === null) continue;
      const problem = this.problem(a, b);
      if (problem) {
        unreadable.push({ line: pair.line, text: pair.text, reason: problem });
        continue;
      }
      bridges.push(this.newBridge(mapId, a, b, { dangerous: request.dangerous, source: 'paste' }));
    }
    return this.save(actor!, mapId, bridges, [...unknown], unreadable, true);
  }

  /**
   * Finds the Ansiblex gates a character can use through ESI: the structures its search finds
   * (its alliance's gates, whichever corporation owns them) and its corporation's own structures
   * (Station Manager role), merged by structure and by pair of systems. One source failing is
   * fine while the other answers.
   */
  async readFromEsi(
    actor: Actor | null,
    mapId: string,
    characterId: number,
  ): Promise<ImportBridgesResultDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'manager');
    const account = requireAccount(actor);
    if ((await this.deps.pilots.ownerOf(characterId)) !== account.id) throw new NotFoundError('Character');
    const [searched, owned] = await Promise.allSettled([
      this.deps.search ? this.deps.search.ansiblexes(characterId) : Promise.resolve(null),
      this.deps.structures.ansiblexes(characterId),
    ]);
    for (const r of [searched, owned]) {
      if (r.status === 'rejected' && !(r.reason instanceof EsiStructuresError)) throw r.reason;
    }
    const searchError = searched.status === 'rejected' ? (searched.reason as EsiStructuresError) : null;
    const corporationError = owned.status === 'rejected' ? (owned.reason as EsiStructuresError) : null;
    const usable = searched.status === 'fulfilled' ? searched.value : null;
    const corporation = owned.status === 'fulfilled' ? owned.value : null;
    if (usable === null && corporation === null) {
      throw this.refusal(searchError ?? corporationError!, this.deps.search !== undefined);
    }
    const notes: string[] = [];
    if (searchError?.reason === 'no-scope')
      notes.push(
        "Only your corporation's gates were read. Link the character again to let Darkbeacon find jump bridges of the whole alliance.",
      );
    else if (searchError)
      notes.push("EVE's structure search did not answer; only your corporation's gates were read.");

    const gates = uniqueStructures([...(usable ?? []), ...(corporation ?? [])]);
    const unreadable: UnreadableLine[] = [];
    const bridges = new Map<string, NewBridge>();
    for (const gate of gates) {
      const far = gate.name ? farSideOf(gate.name, gate.solarSystemId, (n) => this.names.idOf(n)) : null;
      const label = gate.name ?? `Structure ${gate.structureId}`;
      if (far === null) {
        unreadable.push({ line: 0, text: label, reason: 'Its name does not say where it leads' });
        continue;
      }
      const problem = this.problem(gate.solarSystemId, far);
      if (problem) {
        unreadable.push({ line: 0, text: label, reason: problem });
        continue;
      }
      const bridge = this.newBridge(mapId, gate.solarSystemId, far, {
        dangerous: false,
        source: 'esi',
        structureId: gate.structureId,
        structureName: gate.name,
      });
      // Both ends of a bridge are gates of their own: one pair, the first gate named.
      const pair = `${bridge.a}:${bridge.b}`;
      if (!bridges.has(pair)) bridges.set(pair, bridge);
    }
    const result = await this.save(actor!, mapId, [...bridges.values()], [], unreadable, true);
    return { ...result, found: gates.length, ...(notes.length > 0 ? { notes } : {}) };
  }

  /** What to tell a manager when no source answered. */
  private refusal(error: EsiStructuresError, searching: boolean): Error {
    if (error.reason === 'unavailable') return new ConflictError('EVE did not answer; try again in a moment');
    if (searching) {
      if (error.reason === 'forbidden')
        return new ForbiddenError(
          'EVE refused the structure search. Link the character again to let Darkbeacon find jump bridges',
        );
      return new ForbiddenError('Link the character again to let Darkbeacon find jump bridges');
    }
    if (error.reason === 'forbidden')
      return new ForbiddenError(
        "EVE refused: the character needs the Station Manager role, and Darkbeacon needs to read your corporation's structures (link the character again)",
      );
    return new ForbiddenError(
      "Link this character again to let Darkbeacon read its corporation's structures",
    );
  }

  async setDangerous(
    actor: Actor | null,
    mapId: string,
    bridgeId: string,
    dangerous: boolean,
  ): Promise<BridgeDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'manager');
    return this.deps.uow.transaction(async () => {
      const before = await this.deps.bridges.find(mapId, bridgeId);
      if (!before) throw new NotFoundError('Bridge');
      if (before.dangerous === dangerous) return this.dto(before);
      const after = (await this.deps.bridges.setDangerous(mapId, bridgeId, dangerous))!;
      const dto = this.dto(after);
      await this.publish(actor!, mapId, { added: [], updated: [dto], removed: [] });
      return dto;
    });
  }

  async remove(actor: Actor | null, mapId: string, bridgeId: string): Promise<void> {
    await requireMapRole(this.deps.access, actor, mapId, 'manager');
    await this.deps.uow.transaction(async () => {
      const before = await this.deps.bridges.find(mapId, bridgeId);
      if (!before) throw new NotFoundError('Bridge');
      await this.deps.bridges.remove(mapId, [bridgeId]);
      await this.publish(actor!, mapId, { added: [], updated: [], removed: [bridgeId] });
    });
  }

  async clear(actor: Actor | null, mapId: string): Promise<void> {
    await requireMapRole(this.deps.access, actor, mapId, 'manager');
    await this.deps.uow.transaction(async () => {
      const ids = (await this.deps.bridges.list(mapId)).map((b) => b.id);
      if (ids.length === 0) return;
      await this.deps.bridges.remove(mapId, ids);
      await this.publish(actor!, mapId, { added: [], updated: [], removed: ids });
    });
  }

  async forgetMap(mapId: string): Promise<void> {
    await this.deps.bridges.forgetMap(mapId);
  }

  private async save(
    actor: Actor,
    mapId: string,
    bridges: NewBridge[],
    unknown: string[],
    unreadable: UnreadableLine[],
    keepDangerous: boolean,
  ): Promise<ImportBridgesResultDto> {
    return this.deps.uow.transaction(async () => {
      const { added, updated, known } = await this.deps.bridges.upsert(bridges, {
        id: this.deps.newId,
        now: this.deps.clock.now(),
        keepDangerous,
      });
      if (added.length > 0 || updated.length > 0) {
        await this.publish(actor, mapId, {
          added: added.map((b) => this.dto(b)),
          updated: updated.map((b) => this.dto(b)),
          removed: [],
        });
      }
      return {
        added: added.length,
        known,
        unknownSystems: unknown.slice(0, UNKNOWN_SHOWN),
        unreadable,
        bridges: this.sorted((await this.deps.bridges.list(mapId)).map((b) => this.dto(b))),
      };
    });
  }

  private async publish(
    actor: Actor,
    mapId: string,
    data: { added: BridgeDto[]; updated: BridgeDto[]; removed: string[] },
  ): Promise<void> {
    await this.deps.events.append([
      newEvent({
        stream: mapStream(mapId),
        type: 'routes.bridges_changed',
        actor: actorRef(actor),
        data,
        occurredAt: this.deps.clock.now(),
      }),
    ]);
  }

  /** Why two systems cannot be a bridge, or null when they can. */
  private problem(a: number, b: number): string | null {
    if (a === b) return 'Both ends are the same system';
    for (const id of [a, b]) {
      const system = this.deps.universe.getSystem(id)!;
      // Ansiblexes need sovereignty, which only null-sec has.
      if (isWormholeSpace(system) || system.whClass === 25 || system.security > 0)
        return `${system.name} is not in null-sec, where Ansiblexes stand`;
    }
    const ly = this.deps.distances?.lightYears(a, b) ?? null;
    if (ly !== null && ly > ANSIBLEX_RANGE_LY) {
      return `${ly.toFixed(1)} ly apart; an Ansiblex reaches ${ANSIBLEX_RANGE_LY} ly`;
    }
    return null;
  }

  private newBridge(
    mapId: string,
    x: number,
    y: number,
    rest: Pick<NewBridge, 'dangerous' | 'source'> & Partial<Pick<NewBridge, 'structureId' | 'structureName'>>,
  ): NewBridge {
    return {
      mapId,
      a: Math.min(x, y),
      b: Math.max(x, y),
      dangerous: rest.dangerous,
      source: rest.source,
      structureId: rest.structureId ?? null,
      structureName: rest.structureName ?? null,
    };
  }

  private sorted(list: BridgeDto[]): BridgeDto[] {
    return list.sort((x, y) => x.a.name.localeCompare(y.a.name) || x.b.name.localeCompare(y.b.name));
  }

  private dto(b: BridgeRecord): BridgeDto {
    const end = (id: number) => {
      const s = this.deps.universe.getSystem(id);
      return {
        solarSystemId: id,
        name: s?.name ?? String(id),
        security: s?.security ?? 0,
        regionName: s?.regionName ?? '',
      };
    };
    return {
      id: b.id,
      a: end(b.a),
      b: end(b.b),
      dangerous: b.dangerous,
      source: b.source,
      structureName: b.structureName,
      structureId: b.structureId,
      createdAt: b.createdAt,
    };
  }
}

/** Each structure once (the search and the corporation's list may both name it). */
function uniqueStructures(gates: readonly AnsiblexStructure[]): AnsiblexStructure[] {
  const seen = new Set<number>();
  return gates.filter((g) => !seen.has(g.structureId) && seen.add(g.structureId));
}

/** A map's bridges as router edges (ship size does not limit a bridge; mass does, but no hull class). */
export class BridgeEdgeSource implements RouteEdgeSource {
  constructor(private readonly bridges: BridgeRepository) {}

  async edges(mapId: string): Promise<RoutedEdge[]> {
    return (await this.bridges.list(mapId)).map((b) => ({
      a: b.a,
      b: b.b,
      via: 'bridge',
      connectionId: null,
      origin: 'ansiblex',
      state: {
        timeStatus: 'normal',
        massStatus: 'fresh',
        shipSize: 'xlarge',
        dangerous: b.dangerous,
        bubbled: 'none',
      },
    }));
  }
}
