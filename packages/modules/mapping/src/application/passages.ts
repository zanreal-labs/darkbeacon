import { NotFoundError, ValidationError, newId, type Actor } from '@darkbeacon/core';
import {
  jumpMass,
  LogPassagesRequest,
  UpdatePassageRequest,
  type PassageDto,
  type PassageFit,
} from '@darkbeacon/shared';
import type { Connection, Passage } from '../domain/map.js';
import { countingSince } from '../domain/mass.js';
import { MappingUseCases } from './base.js';
import { passageEvent } from './intel.js';

/**
 * The passage log of a connection: listing it, logging jumps of pilots nobody tracks, setting how a
 * jump's mass counts (cold, hot, custom), deleting a mistake and resetting the counter. Every
 * change is an event in the map's stream (audited like any other).
 */
export class PassageUseCases extends MappingUseCases {
  /** Passages of one connection, newest first, with pilot and ship names. */
  async list(actor: Actor | null, mapId: string, connectionId: string): Promise<PassageDto[]> {
    await this.authorize(actor, mapId, 'viewer');
    const merged = await this.ports.overlay?.view(mapId);
    if (merged) {
      const visible = new Set(merged.systems.filter((s) => s.visible).map((s) => s.solarSystemId));
      const connection = merged.connections.find(
        (c) => c.id === connectionId && visible.has(c.source) && visible.has(c.target),
      );
      if (!connection) throw new NotFoundError('Connection');
      const since = countingSince(connection);
      const found = (await this.ports.overlay?.passages?.(mapId, connection)) ?? [];
      return found
        .map((p) => ({
          ...p,
          shipName: p.shipTypeId === null ? null : (this.ports.universe.ship(p.shipTypeId)?.name ?? null),
          counted: since === null || p.occurredAt >= since,
        }))
        .sort((a, b) => b.occurredAt - a.occurredAt);
    }
    const connection = await this.visibleConnection(mapId, connectionId);
    return this.describe(connection, await this.ports.passages.listForConnection(mapId, connectionId));
  }

  /** "Log a jump": a ship (by type) went through `count` times the same way, as the caller says. */
  async log(
    actor: Actor | null,
    mapId: string,
    connectionId: string,
    request: LogPassagesRequest,
  ): Promise<PassageDto[]> {
    const body = LogPassagesRequest.parse(request);
    const who = await this.authorizeEdit(actor, mapId);
    const logged = await this.write(who, mapId, async (events) => {
      const connection = await this.visibleConnection(mapId, connectionId);
      const ship = this.ports.universe.ship(body.shipTypeId);
      if (!ship) throw new ValidationError('Unknown ship type');
      const fit = this.fit(body, ship.higgs, ship.entangler);
      const mass = jumpMass(ship, fit, this.ports.universe.massModifiers());
      const [from, to] =
        body.direction === 'sourceToTarget'
          ? [connection.source, connection.target]
          : [connection.target, connection.source];
      const now = this.ports.clock.now();
      const at = Math.min(body.occurredAt ?? now, now);
      const out: Passage[] = [];
      for (let i = 0; i < body.count; i++) {
        const passage: Passage = {
          id: newId(),
          connectionId: connection.id,
          characterId: null,
          shipTypeId: ship.id,
          mass,
          from,
          to,
          // Jumps logged together keep their order.
          occurredAt: at + i,
          source: 'manual',
          massMode: fit.massMode,
          higgs: fit.higgs ?? false,
          entangler: fit.entangler ?? false,
          note: body.note || null,
          createdBy: who.kind === 'account' ? who.id : null,
        };
        await this.ports.passages.insert(mapId, passage, null);
        events.add('connection.passage', passageEvent(passage));
        out.push(passage);
      }
      return { connection, out };
    });
    return this.describe(logged.connection, logged.out.reverse());
  }

  /** How a passage's mass counts (cold, hot or custom, Higgs, entangler) and its note. */
  async update(
    actor: Actor | null,
    mapId: string,
    connectionId: string,
    passageId: string,
    request: UpdatePassageRequest,
  ): Promise<PassageDto> {
    const body = UpdatePassageRequest.parse(request);
    const who = await this.authorizeEdit(actor, mapId);
    const result = await this.write(who, mapId, async (events) => {
      const connection = await this.ownConnection(mapId, connectionId);
      const current = await this.load(mapId, connection.id, passageId);
      const ship = current.shipTypeId === null ? null : this.ports.universe.ship(current.shipTypeId);
      const massMode = body.massMode ?? current.massMode;
      const fit = this.fit(
        {
          massMode,
          higgs: body.higgs ?? current.higgs,
          entangler: body.entangler ?? current.entangler,
          mass: body.mass ?? (massMode === 'custom' ? (current.mass ?? undefined) : undefined),
        },
        ship?.higgs ?? false,
        ship?.entangler ?? false,
      );
      if (fit.massMode !== 'custom' && !ship)
        throw new ValidationError('The ship of this jump is unknown: give its mass instead');
      const next: Passage = {
        ...current,
        massMode: fit.massMode,
        higgs: fit.higgs ?? false,
        entangler: fit.entangler ?? false,
        mass: jumpMass(ship, fit, this.ports.universe.massModifiers()),
        note: body.note === undefined ? current.note : body.note || null,
      };
      if (JSON.stringify(next) !== JSON.stringify(current)) {
        await this.ports.passages.update(mapId, next);
        events.add(
          'connection.passage_updated',
          { ...passageEvent(next), passageId: next.id },
          { ...passageEvent(current), passageId: current.id },
        );
      }
      return { connection, next };
    });
    return (await this.describe(result.connection, [result.next]))[0]!;
  }

  /** Deletes a passage logged (or recorded) by mistake; the audit trail keeps what it was. */
  async remove(actor: Actor | null, mapId: string, connectionId: string, passageId: string): Promise<void> {
    const who = await this.authorizeEdit(actor, mapId);
    await this.write(who, mapId, async (events) => {
      const connection = await this.ownConnection(mapId, connectionId);
      const current = await this.load(mapId, connection.id, passageId);
      await this.ports.passages.delete(mapId, passageId);
      events.add(
        'connection.passage_removed',
        { passageId, connectionId: connection.id },
        { ...passageEvent(current), passageId: current.id },
      );
    });
  }

  /**
   * "Reset counter": passages count from now on, against the mass status as it is. Earlier
   * passages stay in the log. The same as setting the mass status again (`massStatusAt`).
   */
  async resetCounter(actor: Actor | null, mapId: string, connectionId: string): Promise<Connection> {
    const who = await this.authorizeEdit(actor, mapId);
    return this.write(who, mapId, async (events) => {
      const current = await this.visibleConnection(mapId, connectionId);
      const now = this.ports.clock.now();
      const next: Connection = { ...current, massStatusAt: now, updatedAt: now };
      await this.ports.connections.update(next);
      events.add('connection.updated', next, current);
      return next;
    });
  }

  /** Names and whether the estimate counts each passage; newest first as given. */
  private async describe(connection: Connection, passages: readonly Passage[]): Promise<PassageDto[]> {
    const since = countingSince(connection);
    const pilots = [...new Set(passages.flatMap((p) => (p.characterId === null ? [] : [p.characterId])))];
    const names = pilots.length > 0 && this.ports.pilots ? await this.ports.pilots.names(pilots) : new Map();
    return passages.map((p) => ({
      id: p.id,
      connectionId: p.connectionId,
      characterId: p.characterId,
      characterName: p.characterId === null ? null : (names.get(p.characterId) ?? null),
      shipTypeId: p.shipTypeId,
      shipName: p.shipTypeId === null ? null : (this.ports.universe.ship(p.shipTypeId)?.name ?? null),
      mass: p.mass,
      from: p.from,
      to: p.to,
      occurredAt: p.occurredAt,
      source: p.source,
      massMode: p.massMode,
      higgs: p.higgs,
      entangler: p.entangler,
      note: p.note,
      counted: since === null || p.occurredAt >= since,
      recordedOn: null,
    }));
  }

  /** The fit as asked for, refusing a Higgs Anchor or entangler the ship cannot fit. */
  private fit(request: PassageFit & { mass?: number }, canHiggs: boolean, canEntangle: boolean): PassageFit {
    if (request.higgs && !canHiggs) throw new ValidationError('This ship has no rig slot for a Higgs Anchor');
    if (request.entangler && !canEntangle)
      throw new ValidationError('A mass entangler does not fit this ship');
    if (request.massMode === 'custom') {
      if (request.mass === undefined || request.mass === null)
        throw new ValidationError('A custom mass needs the mass');
      return { massMode: 'custom', mass: request.mass, higgs: false, entangler: false };
    }
    return { massMode: request.massMode, higgs: !!request.higgs, entangler: !!request.entangler };
  }

  private async visibleConnection(mapId: string, connectionId: string): Promise<Connection> {
    const connection = await this.ports.connections.findById(mapId, connectionId);
    if (!connection) throw new NotFoundError('Connection');
    await this.visibleSystem(mapId, connection.source);
    await this.visibleSystem(mapId, connection.target);
    return connection;
  }

  /**
   * The map's own connection behind `connectionId`: itself, or on a map that merges others the
   * row of its own that the merged connection stands for (its passages stay editable there).
   */
  private async ownConnection(mapId: string, connectionId: string): Promise<Connection> {
    if (await this.ports.connections.findById(mapId, connectionId))
      return this.visibleConnection(mapId, connectionId);
    const merged = (await this.ports.overlay?.view(mapId))?.connections.find((c) => c.id === connectionId);
    const own = merged ? await this.ports.connections.findBetween(mapId, merged.source, merged.target) : null;
    if (!own) throw new NotFoundError('Connection');
    return this.visibleConnection(mapId, own.id);
  }

  private async load(mapId: string, connectionId: string, passageId: string): Promise<Passage> {
    const passage = await this.ports.passages.findById(mapId, passageId);
    if (!passage || passage.connectionId !== connectionId) throw new NotFoundError('Passage');
    return passage;
  }
}
