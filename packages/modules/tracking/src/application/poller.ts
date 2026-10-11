import { hasMapRole, mapStream, newEvent, type ActorRef } from '@wormwright/core';
import { observe, type Observation, type TrackedCharacter } from '../domain/presence.js';
import type {
  CharacterTokenSource,
  Clock,
  EsiGateway,
  EventLog,
  MapAccess,
  TrackingRepository,
  UnitOfWork,
} from '../ports/index.js';
import { untrack } from './cleanup.js';
import { blankPresence } from './tracking.js';

export const POLL_INTERVALS = {
  /** Location and ship (ESI caches both for 5 s). */
  location: 5_000,
  online: 60_000,
  /** Retry delay when a character has no usable token. */
  noToken: 60_000,
  /** Two location observations further apart than this may hide several jumps. */
  jumpWindow: 20_000,
  /** How often the tracking account's member role on each map is checked again. */
  access: 60_000,
};

const CONCURRENCY = 8;

interface PollState {
  nextLocationAt: number;
  nextOnlineAt: number;
  etags: { location?: string; ship?: string; online?: string };
  /** Last answer of the online endpoint; null until asked. */
  online: boolean | null;
  /** When this process last got a location answer; jumps are only detected between close answers. */
  locationSeenAt: number | null;
  /** When the map roles of the tracking accounts were last checked. */
  accessCheckedAt: number;
}

/**
 * Polls ESI for characters tracked on at least one map and turns changes into `character.*`
 * events on every map that tracks the character. Location and ship are polled only while the
 * character is online (or not known to be offline). Call `tick()` about once a second.
 *
 * A character is only polled for the account that tracked it: when it belongs to another
 * account now, or that account lost member rights on a map, it is untracked there instead.
 */
export class TrackingPoller {
  private readonly states = new Map<number, PollState>();
  private running = false;

  constructor(
    private readonly deps: {
      tracking: TrackingRepository;
      characters: CharacterTokenSource;
      access: MapAccess;
      esi: EsiGateway;
      events: EventLog;
      uow: UnitOfWork;
      clock: Clock;
      onError?: (error: unknown, characterId: number) => void;
    },
    private readonly actor: ActorRef = { kind: 'system', id: 'tracking' },
  ) {}

  /** Polls every character that is due. A call while the previous one still runs is skipped. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.deps.clock.now();
      const characters = new Map<number, TrackedCharacter[]>();
      for (const t of await this.deps.tracking.listTracked()) {
        characters.set(t.characterId, [...(characters.get(t.characterId) ?? []), t]);
      }
      for (const id of this.states.keys()) if (!characters.has(id)) this.states.delete(id);

      const due = [...characters].filter(([id]) => {
        const state = this.stateOf(id, now);
        return state.nextLocationAt <= now || state.nextOnlineAt <= now;
      });
      await eachLimited(due, CONCURRENCY, async ([id, entries]) => {
        try {
          await this.poll(id, entries, now);
        } catch (error) {
          const state = this.stateOf(id, now);
          state.nextLocationAt = state.nextOnlineAt = now + POLL_INTERVALS.noToken;
          this.deps.onError?.(error, id);
        }
      });
    } finally {
      this.running = false;
    }
  }

  /** Map access changed somewhere: check the tracking accounts' roles again on the next tick. */
  recheckAccess(): void {
    for (const state of this.states.values()) state.accessCheckedAt = -Infinity;
  }

  private stateOf(characterId: number, now: number): PollState {
    let state = this.states.get(characterId);
    if (!state) {
      state = {
        nextLocationAt: now,
        nextOnlineAt: now,
        etags: {},
        online: null,
        locationSeenAt: null,
        accessCheckedAt: -Infinity,
      };
      this.states.set(characterId, state);
    }
    return state;
  }

  /** The entries that may still be polled; the others are untracked. */
  private async allowed(id: number, entries: TrackedCharacter[], now: number): Promise<TrackedCharacter[]> {
    const { characters, access } = this.deps;
    const state = this.stateOf(id, now);
    const owner = await characters.character(id);
    let kept = entries.filter((e) => e.accountId === owner?.accountId);
    if (kept.length > 0 && state.accessCheckedAt + POLL_INTERVALS.access <= now) {
      state.accessCheckedAt = now;
      const roles = await Promise.all(
        kept.map((e) => access.roleOf({ kind: 'account', id: e.accountId, instanceRole: 'user' }, e.mapId)),
      );
      kept = kept.filter((_, i) => hasMapRole(roles[i] ?? null, 'member'));
    }
    await untrack(
      this.deps,
      entries.filter((e) => !kept.includes(e)),
      this.actor,
      now,
    );
    return kept;
  }

  private async poll(id: number, entries: TrackedCharacter[], now: number): Promise<void> {
    const { esi, characters, tracking } = this.deps;
    const state = this.stateOf(id, now);
    const kept = await this.allowed(id, entries, now);
    if (kept.length === 0) return;
    const accountId = kept[0]!.accountId;
    const mapIds = kept.map((e) => e.mapId);
    const token = await characters.accessToken(id);
    if (!token) {
      state.nextLocationAt = state.nextOnlineAt = now + POLL_INTERVALS.noToken;
      return;
    }
    const seen: Observation = { continuous: false };

    if (state.nextOnlineAt <= now) {
      const online = await esi.online(id, token, state.etags.online);
      if (online.ok) {
        state.etags.online = online.etag ?? undefined;
        state.nextOnlineAt = Math.max(now + POLL_INTERVALS.online, online.expiresAt);
        if (online.data) state.online = seen.online = online.data.online;
      } else {
        state.nextOnlineAt = online.retryAt;
      }
    }

    if (state.nextLocationAt <= now && state.online === false) {
      state.nextLocationAt = state.nextOnlineAt;
    } else if (state.nextLocationAt <= now) {
      const [location, ship] = await Promise.all([
        esi.location(id, token, state.etags.location),
        esi.ship(id, token, state.etags.ship),
      ]);
      let next = now + POLL_INTERVALS.location;
      if (location.ok) {
        state.etags.location = location.etag ?? undefined;
        next = Math.max(next, location.expiresAt);
        if (location.data) {
          const { solarSystemId, stationId, structureId } = location.data;
          seen.location = { solarSystemId, docked: stationId !== null || structureId !== null };
        }
        seen.continuous =
          state.locationSeenAt !== null && now - state.locationSeenAt <= POLL_INTERVALS.jumpWindow;
        state.locationSeenAt = now;
      } else {
        next = Math.max(next, location.retryAt);
      }
      if (ship.ok) {
        state.etags.ship = ship.etag ?? undefined;
        next = Math.max(next, ship.expiresAt);
        if (ship.data) seen.ship = { shipTypeId: ship.data.shipTypeId, shipName: ship.data.shipName };
      } else {
        next = Math.max(next, ship.retryAt);
      }
      state.nextLocationAt = next;
    }

    let presence = await tracking.getPresence(id);
    if (!presence) {
      const owner = await characters.character(id);
      presence = { ...blankPresence(id, now), accountId, name: owner?.name ?? String(id) };
    }
    const { presence: updated, changes } = observe(presence, seen, now);
    if (changes.length === 0) return;
    await this.deps.uow.transaction(async () => {
      await tracking.savePresence(updated);
      await this.deps.events.append(
        mapIds.flatMap((mapId) =>
          changes.map((change) =>
            newEvent({
              stream: mapStream(mapId),
              type: change.type,
              actor: this.actor,
              data: change.data,
              occurredAt: now,
            }),
          ),
        ),
      );
    });
  }
}

async function eachLimited<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
