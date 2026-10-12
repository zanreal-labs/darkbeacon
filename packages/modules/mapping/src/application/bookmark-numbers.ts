import { ConflictError, NotFoundError, ValidationError, type Actor } from '@darkbeacon/core';
import {
  bookmarkClassLabel,
  chainTree,
  DEFAULT_BOOKMARK_NUMBERING,
  numbersBookmark,
  type BookmarkNumbering,
} from '@darkbeacon/shared';
import {
  assignBookmarkNumbers,
  moveBookmarkNumber,
  type NumberingCandidate,
  type Renumber,
} from '../domain/bookmark-numbers.js';
import type { Connection } from '../domain/map.js';
import { MappingUseCases, type EventBatch, type MappingPorts } from './base.js';

/** Who backfills numbers for connections that were mapped before numbering existed. */
const NUMBERING_ACTOR: Actor = { kind: 'system', id: 'bookmark-numbers' };

export interface RenumberOptions {
  /** Systems whose wormholes are numbered 1, 2, 3 again; by default numbers are kept. */
  renumber?: Renumber;
  /** The numbering to apply; by default the map's. */
  numbering?: BookmarkNumbering;
  /** Numbers set by hand in this change, by connection id; they win over the stored ones. */
  override?: ReadonlyMap<string, number>;
}

interface Plan {
  candidates: NumberingCandidate[];
  connections: Connection[];
  numbering: BookmarkNumbering;
}

async function plan(ports: MappingPorts, mapId: string, numbering?: BookmarkNumbering): Promise<Plan> {
  const map = await ports.maps.findById(mapId);
  const systems = await ports.systems.list(mapId);
  const connections = await ports.connections.list(mapId);
  const signatures = await ports.signatures.listForMap(mapId);
  const candidates: NumberingCandidate[] = [];
  for (const { parent, child, connection: c } of chainTree(systems, connections).steps) {
    if (!numbersBookmark(c)) continue;
    const sig = signatures.find((s) => s.connectionId === c.id && s.solarSystemId === parent);
    candidates.push({
      connectionId: c.id,
      parent,
      createdAt: c.createdAt,
      signature: sig?.eveId ?? null,
      destClass: bookmarkClassLabel(ports.universe.getSystem(child) ?? undefined),
      number: c.bookmarkParent === parent ? (c.bookmarkNumber ?? null) : null,
    });
  }
  return {
    candidates,
    connections,
    numbering: numbering ?? map?.settings.bookmarkNumbering ?? DEFAULT_BOOKMARK_NUMBERING,
  };
}

/**
 * Brings every connection's `{n}` up to date with the chain as it is now (see
 * `assignBookmarkNumbers`), inside the caller's transaction. Each change is a
 * `connection.updated` with the connection before it, so it is published and audited like any
 * edit; a connection added in the same change is published once, numbered. Returns the
 * connections that changed, by id.
 */
export async function renumberBookmarks(
  ports: MappingPorts,
  events: EventBatch,
  mapId: string,
  options: RenumberOptions = {},
): Promise<Map<string, Connection>> {
  const { candidates, connections, numbering } = await plan(ports, mapId, options.numbering);
  const override = options.override;
  const input = override
    ? candidates.map((c) =>
        override.has(c.connectionId) ? { ...c, number: override.get(c.connectionId)! } : c,
      )
    : candidates;
  const numbers = assignBookmarkNumbers(input, numbering, options.renumber);
  const parentOf = new Map(candidates.map((c) => [c.connectionId, c.parent]));

  const changed = new Map<string, Connection>();
  const now = ports.clock.now();
  for (const current of connections) {
    const bookmarkNumber = numbers.get(current.id) ?? null;
    const bookmarkParent = bookmarkNumber === null ? null : parentOf.get(current.id)!;
    if (
      (current.bookmarkNumber ?? null) === bookmarkNumber &&
      (current.bookmarkParent ?? null) === bookmarkParent
    )
      continue;
    const next: Connection = { ...current, bookmarkNumber, bookmarkParent, updatedAt: now };
    await ports.connections.update(next);
    events.add('connection.updated', next, current);
    changed.set(next.id, next);
  }
  return changed;
}

/** `{n}` by hand, renumbering on request, and numbers for connections from before numbering. */
export class BookmarkNumberUseCases extends MappingUseCases {
  /** Moves a wormhole to `number` among the wormholes out of its parent (member+). */
  async setNumber(
    actor: Actor | null,
    mapId: string,
    connectionId: string,
    number: number,
  ): Promise<Connection> {
    const who = await this.authorize(actor, mapId, 'member');
    await this.ownNumbers(mapId);
    return this.write(who, mapId, async (events) => {
      const current = await this.ports.connections.findById(mapId, connectionId);
      if (!current) throw new NotFoundError('Connection');
      const { candidates } = await plan(this.ports, mapId);
      const self = candidates.find((c) => c.connectionId === connectionId);
      if (!self) throw new ValidationError('Only wormholes are numbered');
      const siblings = candidates.filter((c) => c.parent === self.parent);
      const override = moveBookmarkNumber(siblings, connectionId, number);
      const changed = await renumberBookmarks(this.ports, events, mapId, { override });
      return changed.get(connectionId) ?? current;
    });
  }

  /** Numbers the wormholes out of `parent` (every system when absent) 1, 2, 3 again (member+). */
  async renumber(actor: Actor | null, mapId: string, parent?: number): Promise<void> {
    const who = await this.authorize(actor, mapId, 'member');
    await this.ownNumbers(mapId);
    await this.write(who, mapId, async (events) => {
      await renumberBookmarks(this.ports, events, mapId, {
        renumber: parent === undefined ? 'all' : new Set([parent]),
      });
    });
  }

  /**
   * A map that merges others shows its sources' wormholes: their numbers are theirs, and the map
   * counts `{n}` in its own order where it is shown, so there is nothing to set by hand.
   */
  private async ownNumbers(mapId: string): Promise<void> {
    if (await this.ports.overlay?.view(mapId))
      throw new ConflictError(
        'This map merges others: its wormholes are numbered in the map’s order as shown',
      );
  }

  /**
   * Numbers the wormholes of maps that have unnumbered ones (mapped before numbering existed),
   * keeping any number already given. Run by the server at startup; returns the maps it touched.
   */
  async backfill(): Promise<string[]> {
    const mapIds = await this.ports.connections.mapsWithUnnumberedWormholes();
    for (const mapId of mapIds) {
      await this.write(NUMBERING_ACTOR, mapId, (events) => renumberBookmarks(this.ports, events, mapId));
    }
    return mapIds;
  }
}
