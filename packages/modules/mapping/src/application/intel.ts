import { newId, NotFoundError, ValidationError, type Actor } from '@darkbeacon/core';
import {
  jumpMass,
  RollPlanRequest,
  type ConnectionIntelDto,
  type RollCrewShipDto,
  type RollPlanDto,
} from '@darkbeacon/shared';
import { fitMass } from '../domain/fit.js';
import { byUrgency, connectionIntel } from '../domain/intel.js';
import type { Connection, Passage, Signature } from '../domain/map.js';
import { planRoll, type RollShip } from '../domain/rolling.js';
import type { ChainView } from '../domain/stamps.js';
import { MappingUseCases } from './base.js';

/** The connections panel: every visible connection with derived type, mass and time, most urgent first. */
export class ConnectionIntelQuery extends MappingUseCases {
  async list(actor: Actor | null, mapId: string): Promise<ConnectionIntelDto[]> {
    await this.authorize(actor, mapId, 'viewer');
    const chain = await this.chain(mapId);
    const passages = chain.merged ? null : await this.ports.passages.listForMap(mapId);
    const intel: ConnectionIntelDto[] = [];
    for (const connection of chain.connections) {
      const through = passages
        ? passages.filter((p) => p.connectionId === connection.id)
        : await this.mergedPassages(mapId, connection);
      intel.push(this.intelOf(connection, chain.signatures, through));
    }
    return intel.sort(byUrgency);
  }

  /** One visible connection, as the sidebar shows it. */
  async one(actor: Actor | null, mapId: string, connectionId: string): Promise<ConnectionIntelDto> {
    await this.authorize(actor, mapId, 'viewer');
    const chain = await this.chain(mapId);
    const connection = chain.connections.find((c) => c.id === connectionId);
    if (!connection) throw new NotFoundError('Connection');
    const through = chain.merged
      ? await this.mergedPassages(mapId, connection)
      : await this.ports.passages.listForConnection(mapId, connectionId);
    return this.intelOf(connection, chain.signatures, through);
  }

  /**
   * A rolling plan for a connection with the crew's ships (masses from the SDE). What is left is
   * the estimate's range unless the crew says otherwise.
   */
  async rollPlan(
    actor: Actor | null,
    mapId: string,
    connectionId: string,
    request: RollPlanRequest,
  ): Promise<RollPlanDto> {
    const body = RollPlanRequest.parse(request);
    const intel = await this.one(actor, mapId, connectionId);
    const { universe } = this.ports;
    const modifiers = universe.massModifiers();
    const limit = intel.maxJumpMass;
    const crew: RollCrewShipDto[] = [];
    const ships: RollShip[] = [];
    for (const wanted of body.ships) {
      const weighed = wanted.fit ? fitMass(wanted.fit, universe) : null;
      if (wanted.fit && !weighed) throw new ValidationError('Not a fit this server knows');
      const ship = weighed?.ship ?? universe.ship(wanted.shipTypeId);
      if (!ship) throw new NotFoundError('Ship');
      // A Higgs Anchor is a rig: always on. The mass entangler is a module: on going out (cold),
      // off coming back hot with the prop module running.
      // A fit's masses include its plates and rigs; the entangler is switched on going out.
      const entangled = wanted.entangler && ship.entangler ? 1 + modifiers.entanglerPercent / 100 : 1;
      const cold = weighed
        ? Math.round(weighed.cold * entangled)
        : jumpMass(ship, { massMode: 'cold', higgs: wanted.higgs, entangler: wanted.entangler }, modifiers)!;
      const hot = weighed
        ? weighed.hot
        : jumpMass(ship, { massMode: 'hot', higgs: wanted.higgs }, modifiers)!;
      const name = [
        weighed?.name ? `${ship.name} (${weighed.name})` : ship.name,
        ...(!weighed && wanted.higgs && ship.higgs ? ['Higgs'] : []),
        ...(wanted.entangler && ship.entangler ? ['entangler'] : []),
      ].join(' + ');
      crew.push({ shipTypeId: ship.id, name, cold, hot, tooHeavy: limit !== null && cold > limit });
      for (let i = 0; i < wanted.count; i++)
        ships.push({
          index: ships.length,
          shipTypeId: ship.id,
          name: wanted.count > 1 ? `${name} ${i + 1}` : name,
          cold,
          hot,
        });
    }
    const remaining = body.remaining ?? intel.mass.range;
    const outcome = intel.mass.regenerates
      ? { result: 'impossible' as const, reason: 'regenerates' as const, steps: [] }
      : planRoll({ remaining, maxJumpMass: limit, total: intel.mass.total, ships });
    return {
      ...outcome,
      remaining: remaining ?? null,
      maxJumpMass: limit,
      crew,
    };
  }

  /** Visible connections and signatures: the merged chain on a map that merges others. */
  private async chain(
    mapId: string,
  ): Promise<{ merged: ChainView | null; connections: Connection[]; signatures: Signature[] }> {
    const merged = (await this.ports.overlay?.view(mapId)) ?? null;
    const visible = new Set(
      (merged?.systems ?? (await this.ports.systems.list(mapId)))
        .filter((s) => s.visible)
        .map((s) => s.solarSystemId),
    );
    const connections = (merged?.connections ?? (await this.ports.connections.list(mapId))).filter(
      (c) => visible.has(c.source) && visible.has(c.target),
    );
    const signatures = merged?.signatures ?? (await this.ports.signatures.listForMap(mapId));
    return { merged, connections, signatures };
  }

  /** A merged connection's passages: summed from the sources that share its status. */
  private async mergedPassages(
    mapId: string,
    connection: Connection,
  ): Promise<Array<Pick<Passage, 'occurredAt' | 'mass'>>> {
    return (await this.ports.overlay?.passages?.(mapId, connection)) ?? [];
  }

  private intelOf(
    connection: Connection,
    signatures: readonly Signature[],
    passages: ReadonlyArray<Pick<Passage, 'occurredAt' | 'mass'>>,
  ): ConnectionIntelDto {
    const { universe } = this.ports;
    return connectionIntel({
      connection,
      source: universe.getSystem(connection.source),
      target: universe.getSystem(connection.target),
      signatures: signatures.filter((s) => s.connectionId === connection.id),
      passages,
      wormholeType: (code) => universe.wormholeType(code),
      hullClasses: universe.hullClasses(),
      now: this.ports.clock.now(),
    });
  }
}

/** A tracked character's jump, as read from the map's event stream. */
export interface ObservedJump {
  mapId: string;
  /** Id of the `character.jumped` event: a jump is recorded once. */
  eventId: string;
  characterId: number;
  shipTypeId: number | null;
  from: number;
  to: number;
  occurredAt: number;
}

const RECORDER: Actor = { kind: 'system', id: 'mapping' };

/**
 * Records jumps through the map's connections as passages (cold: the ship's hull mass from the
 * SDE; someone who knows the prop module was running sets it hot) and publishes
 * `connection.passage`. Called by a durable consumer of the map streams, so it needs no map role;
 * jumps between systems with no connection on the map are ignored.
 */
export class PassageRecorder extends MappingUseCases {
  async record(jump: ObservedJump): Promise<boolean> {
    return this.write(RECORDER, jump.mapId, async (events) => {
      const connection = await this.ports.connections.findBetween(jump.mapId, jump.from, jump.to);
      if (!connection) return false;
      const passage: Passage = {
        id: newId(),
        connectionId: connection.id,
        characterId: jump.characterId,
        shipTypeId: jump.shipTypeId,
        mass: jump.shipTypeId === null ? null : this.ports.universe.shipMass(jump.shipTypeId),
        from: jump.from,
        to: jump.to,
        occurredAt: jump.occurredAt,
        source: 'tracked',
        massMode: 'cold',
        higgs: false,
        entangler: false,
        note: null,
        createdBy: null,
      };
      if (!(await this.ports.passages.insert(jump.mapId, passage, jump.eventId))) return false;
      events.add('connection.passage', passageEvent(passage));
      return true;
    });
  }
}

/** A passage as events carry it. */
export function passageEvent(p: Passage) {
  return {
    connectionId: p.connectionId,
    characterId: p.characterId,
    shipTypeId: p.shipTypeId,
    mass: p.mass,
    from: p.from,
    to: p.to,
    passageId: p.id,
    source: p.source,
    massMode: p.massMode,
    higgs: p.higgs,
    entangler: p.entangler,
    note: p.note,
  };
}
