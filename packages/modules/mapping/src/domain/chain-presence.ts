import {
  chainFromHome,
  isMergeEvent,
  type ConnectionDto,
  type EventPayloads,
  type MapSystemDto,
} from '@darkbeacon/shared';

/**
 * A system's record in a map's chain from home: `joinedAt` when it last became reachable from
 * home, `leftAt` when it stopped being (hidden, its last connection home gone, home moved); null
 * while it still is. The moment a system leaves counts as the last moment it was in the chain.
 */
export interface ChainPresence {
  mapId: string;
  solarSystemId: number;
  joinedAt: number;
  leftAt: number | null;
}

/**
 * The rows to write after the chain became `members` at `now`: systems that joined (new, or back
 * after leaving) and systems that left. Systems that stay in or stay out are not touched, so a
 * chain that did not change writes nothing.
 */
export function chainPresenceChanges(
  mapId: string,
  current: Iterable<ChainPresence>,
  members: ReadonlySet<number>,
  now: number,
): ChainPresence[] {
  const known = new Map<number, ChainPresence>();
  for (const row of current) known.set(row.solarSystemId, row);
  const changes: ChainPresence[] = [];
  for (const solarSystemId of members) {
    const row = known.get(solarSystemId);
    if (row && row.leftAt === null) continue;
    changes.push({ mapId, solarSystemId, joinedAt: now, leftAt: null });
  }
  for (const row of known.values()) {
    if (row.leftAt === null && !members.has(row.solarSystemId)) changes.push({ ...row, leftAt: now });
  }
  return changes;
}

/** A map event as the log keeps it, for a replay. */
export interface ReplayedEvent {
  type: string;
  occurredAt: number;
  actor: { kind: string; id: string };
  data: unknown;
}

type ReplayedSystem = Pick<MapSystemDto, 'solarSystemId' | 'status' | 'visible' | 'createdAt'>;

/**
 * Plays a map's own history back (its event log from the first event, a page at a time) and
 * records the chain as it was after each change: the rows the map would have had if it had kept
 * them all along. Only what moves the chain counts (systems shown, hidden or (un)made home,
 * connections added, removed or moved to other systems); events a merge wrote are left out, they
 * describe other maps' objects.
 */
export class ChainReplay {
  private readonly systems = new Map<number, ReplayedSystem>();
  private readonly connections = new Map<string, Pick<ConnectionDto, 'source' | 'target'>>();
  private readonly presence = new Map<number, ChainPresence>();

  constructor(private readonly mapId: string) {}

  apply(event: ReplayedEvent): void {
    if (isMergeEvent(event) || !moves(event, this.systems, this.connections)) return;
    const members = chainFromHome(this.systems.values(), this.connections.values());
    for (const row of chainPresenceChanges(this.mapId, this.presence.values(), members, event.occurredAt))
      this.presence.set(row.solarSystemId, row);
  }

  rows(): ChainPresence[] {
    return [...this.presence.values()];
  }
}

/** `ChainReplay` over a whole history at once. */
export function replayChainPresence(mapId: string, events: Iterable<ReplayedEvent>): ChainPresence[] {
  const replay = new ChainReplay(mapId);
  for (const event of events) replay.apply(event);
  return replay.rows();
}

/** Applies one event to the replayed chain; true when the chain may have changed. */
function moves(
  event: ReplayedEvent,
  systems: Map<number, ReplayedSystem>,
  connections: Map<string, Pick<ConnectionDto, 'source' | 'target'>>,
): boolean {
  switch (event.type) {
    case 'system.added':
    case 'system.updated': {
      const s = event.data as EventPayloads['system.added'];
      const before = systems.get(s.solarSystemId);
      const next: ReplayedSystem = {
        solarSystemId: s.solarSystemId,
        status: s.status,
        visible: s.visible ?? true,
        createdAt: s.createdAt ?? before?.createdAt ?? event.occurredAt,
      };
      systems.set(s.solarSystemId, next);
      return (
        !before ||
        before.visible !== next.visible ||
        (before.status === 'home') !== (next.status === 'home') ||
        before.createdAt !== next.createdAt
      );
    }
    case 'system.removed': {
      const { solarSystemId } = event.data as EventPayloads['system.removed'];
      const before = systems.get(solarSystemId);
      if (!before?.visible) return false;
      systems.set(solarSystemId, { ...before, visible: false });
      return true;
    }
    case 'connection.added':
    case 'connection.updated': {
      const c = event.data as EventPayloads['connection.added'];
      const before = connections.get(c.id);
      connections.set(c.id, { source: c.source, target: c.target });
      return !before || before.source !== c.source || before.target !== c.target;
    }
    case 'connection.removed':
      return connections.delete((event.data as EventPayloads['connection.removed']).id);
    default:
      return false;
  }
}
