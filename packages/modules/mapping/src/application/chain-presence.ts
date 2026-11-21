import { mapStream, type Actor } from '@darkbeacon/core';
import { chainFromHome, type ChainPresenceListDto, type MapSystemDto } from '@darkbeacon/shared';
import { ChainReplay, chainPresenceChanges } from '../domain/chain-presence.js';
import { MappingUseCases } from './base.js';

/** Event types after which a map's chain from home may be different. */
export const CHAIN_EVENT_TYPES = [
  'system.added',
  'system.updated',
  'system.removed',
  'connection.added',
  'connection.updated',
  'connection.removed',
  'map.sources_changed',
] as const;

/** Events read at a time while a map's history is played back. */
const PAGE = 500;

/** How the history backfill went for one map. */
export type ChainBackfill = 'replayed' | 'recorded' | 'kept';

/**
 * When each system was last in a map's chain from home (`chainFromHome`): the map records it as
 * its chain changes (`record`, after every change of its systems or connections, home included)
 * and answers it for a system pilots look at ("last in our chain 3 d ago"). A map that merges
 * others records the chain it shows, the merged one.
 */
export class ChainPresenceUseCases extends MappingUseCases {
  /** Each map's home systems at its last recording: edits of other systems cannot move the chain. */
  private readonly homes = new Map<string, Set<number>>();

  /** Every system the map's chain ever held (viewer+). */
  async list(actor: Actor | null, mapId: string): Promise<ChainPresenceListDto> {
    await this.authorize(actor, mapId, 'viewer');
    const rows = (await this.ports.presence?.list(mapId)) ?? [];
    return {
      recordedSince: rows.length > 0 ? Math.min(...rows.map((r) => r.joinedAt)) : null,
      systems: rows
        .map(({ solarSystemId, joinedAt, leftAt, previousLeftAt }) => ({
          solarSystemId,
          joinedAt,
          leftAt,
          previousLeftAt,
        }))
        .sort((a, b) => a.solarSystemId - b.solarSystemId),
    };
  }

  /** Whether a change of the map (one of `CHAIN_EVENT_TYPES`) may move its chain. */
  moves(mapId: string, type: string, data: unknown): boolean {
    if (type !== 'system.updated') return true;
    const homes = this.homes.get(mapId);
    const system = data as Partial<MapSystemDto> | null;
    if (!homes || typeof system?.solarSystemId !== 'number') return true;
    return (system.status === 'home') !== homes.has(system.solarSystemId);
  }

  /**
   * Records the map's chain as it is now: systems that joined it since the last recording get
   * `joinedAt` now, the ones that left get `leftAt` now. Returns how many rows changed.
   */
  async record(mapId: string): Promise<number> {
    const presence = this.ports.presence;
    if (!presence) return 0;
    return this.ports.uow.transaction(async () => {
      const map = await this.ports.maps.findById(mapId);
      if (!map) return 0;
      const changes = chainPresenceChanges(
        mapId,
        await presence.list(mapId),
        await this.chain(mapId),
        this.ports.clock.now(),
      );
      if (changes.length > 0) await presence.put(changes);
      return changes.length;
    });
  }

  /**
   * Fills the record of a map that has none yet from its history, when the map's event log goes
   * back to its first event (nothing pruned) and the map shows only its own objects (a merged
   * chain's past is in other maps' logs); then records the chain as it is now. A map with a record
   * is only brought up to date.
   */
  async backfill(mapId: string): Promise<ChainBackfill> {
    const presence = this.ports.presence;
    if (!presence) return 'kept';
    if (await presence.any(mapId)) {
      await this.record(mapId);
      return 'kept';
    }
    const map = await this.ports.maps.findById(mapId);
    if (!map) return 'kept';
    const stream = mapStream(mapId);
    const whole =
      map.kind !== 'composite' &&
      !(await this.ports.overlay?.view(mapId)) &&
      (await this.ports.events.oldestSeq(stream)) === 1;
    if (whole) {
      const replay = new ChainReplay(mapId);
      for (let seq = 0; ;) {
        const page = await this.ports.events.readSince(stream, seq, PAGE);
        if (page.length === 0) break;
        for (const event of page) replay.apply(event);
        seq = page.at(-1)!.seq;
      }
      const rows = replay.rows();
      await this.ports.uow.transaction(async () => {
        // Recorded meanwhile (a change came first): that record stands.
        if (rows.length > 0 && !(await presence.any(mapId))) await presence.put(rows);
      });
    }
    await this.record(mapId);
    return whole ? 'replayed' : 'recorded';
  }

  /** `backfill` for every map; returns the maps whose history was played back. */
  async backfillAll(): Promise<string[]> {
    const replayed: string[] = [];
    for (const mapId of await this.ports.maps.allIds())
      if ((await this.backfill(mapId)) === 'replayed') replayed.push(mapId);
    return replayed;
  }

  /** The chain the map shows now: merged on a map that merges others, else its own. */
  private async chain(mapId: string): Promise<Set<number>> {
    const merged = await this.ports.overlay?.view(mapId);
    // A merged view holds only the systems it shows.
    const systems = merged
      ? merged.systems.map((s) => ({ ...s, visible: true }))
      : await this.ports.systems.list(mapId);
    const connections = merged ? merged.connections : await this.ports.connections.list(mapId);
    this.homes.set(
      mapId,
      new Set(systems.filter((s) => s.visible && s.status === 'home').map((s) => s.solarSystemId)),
    );
    return chainFromHome(systems, connections);
  }
}
