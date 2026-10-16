import { hasMapRole, mapStream, newEvent, type ActorRef } from '@darkbeacon/core';
import type { TrackingProblemKind } from '@darkbeacon/shared';
import { observe, type Observation, type TrackedCharacter } from '../domain/presence.js';
import type {
  CharacterTokenSource,
  Clock,
  EsiGateway,
  EsiResult,
  EventLog,
  MapAccess,
  MapViewers,
  RateLimiter,
  TrackingProblemStore,
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
  /**
   * How often the tracking account's member role on each map, and who owns the character, are
   * checked again (at once after an access change).
   */
  access: 60_000,
  /** The list of tracked characters is read again at most this often (at once after a change). */
  tracked: 5_000,
  /** An access token is reused this long; tokens are refreshed a minute before they expire. */
  token: 30_000,
};

export interface PollerOptions {
  /** Characters polled at the same time (each waits on ESI for a round trip or two). */
  concurrency?: number;
  /** First polls after a start are spread over this long, so a restart does not burst. */
  startupSpreadMs?: number;
  /** Up to this much is added to every next poll, so characters do not line up. */
  jitterMs?: number;
  random?: () => number;
}

/**
 * What stops tracking from reading a character's location. `sign-in` (no usable token) is only
 * logged: the owner sees an expired sign-in on the character itself, and demo or dev characters
 * never have one.
 */
export interface PollProblem {
  kind: TrackingProblemKind | 'sign-in';
  message: string;
}

/** The ESI scope each route needs, named in what the owner is told. */
const ROUTE_SCOPES = {
  online: 'esi-location.read_online.v1',
  location: 'esi-location.read_location.v1',
  ship: 'esi-location.read_ship_type.v1',
} as const;

const NO_TOKEN: PollProblem = {
  kind: 'sign-in',
  message: 'No usable EVE sign-in (it expired or EVE refused to refresh it): link the character again.',
};

/**
 * What one ESI answer says about tracking: fine (`ok`), nothing (`unknown`: the gateway held the
 * request back to pace itself) or a problem.
 */
export function problemOf(
  route: keyof typeof ROUTE_SCOPES,
  result: EsiResult<unknown>,
): PollProblem | 'ok' | 'unknown' {
  if (result.ok) return 'ok';
  const { reason } = result;
  if (reason === 'rate limited') return 'unknown';
  if (/HTTP 40[13]\b/.test(reason))
    return {
      kind: 'refused',
      message: `ESI refused the ${route} (${reason}): link the character again so it grants ${ROUTE_SCOPES[route]}.`,
    };
  if (/\b42[09]\b/.test(reason))
    return {
      kind: 'unavailable',
      message: `ESI is limiting requests (${reason}); tracking waits and retries.`,
    };
  return { kind: 'unavailable', message: `ESI did not answer the ${route} (${reason}); tracking retries.` };
}

const DEFAULTS: Required<PollerOptions> = {
  concurrency: 64,
  startupSpreadMs: 15_000,
  jitterMs: 500,
  random: Math.random,
};

interface PollState {
  nextLocationAt: number;
  nextOnlineAt: number;
  etags: { location?: string; ship?: string; online?: string };
  /** Last answer of the online endpoint; null until asked. */
  online: boolean | null;
  /** When this process last got a location answer; jumps are only detected between close answers. */
  locationSeenAt: number | null;
  /** When ownership and the map roles of the tracking accounts were last checked. */
  accessCheckedAt: number;
  /** Entries that passed that check (until the next one). */
  allowed: TrackedCharacter[];
  token: { value: string; until: number } | null;
  /**
   * What each route answered last (absent: fine or not asked yet). A route asked less often
   * (online) answering fine says nothing about another (location) that failed.
   */
  failing: Partial<Record<keyof typeof ROUTE_SCOPES, PollProblem>>;
  /**
   * The problem last reported for the character (null: none); undefined until the first poll of
   * this process, which reports either way and so clears what an earlier process left.
   */
  reported?: PollProblem | null;
}

/**
 * Polls ESI for characters tracked on at least one map and turns changes into `character.*`
 * events on every map that tracks the character. Call `tick()` about once a second; ticks may
 * overlap, a character is never polled twice at once.
 *
 * - Online first: location and ship are asked only while the character is online (or not known
 *   to be offline), online every 60 s, location and ship every 5 s or later if ESI's cache says so.
 * - At most `concurrency` characters at once, and only what the global `budget` allows; when it
 *   is short, characters on maps someone is looking at go first, then the longest overdue.
 * - First polls after a start are spread out, and every next poll gets a little jitter.
 * - An answer that changed nothing (304) touches no database at all.
 *
 * A character is only polled for the account that tracked it: when it belongs to another
 * account now, or that account lost member rights on a map, it is untracked there instead.
 */
export class TrackingPoller {
  private readonly states = new Map<number, PollState>();
  private readonly inflight = new Set<number>();
  private tracked: { at: number; byCharacter: Map<number, TrackedCharacter[]> } | null = null;
  private loadingTracked: Promise<Map<number, TrackedCharacter[]>> | null = null;
  private readonly options: Required<PollerOptions>;
  private startedAt: number | null = null;

  constructor(
    private readonly deps: {
      tracking: TrackingRepository;
      characters: CharacterTokenSource;
      access: MapAccess;
      esi: EsiGateway;
      events: EventLog;
      uow: UnitOfWork;
      clock: Clock;
      /** Global ESI request budget; unlimited without one. */
      budget?: RateLimiter;
      /** Maps someone has open; without it every map counts the same. */
      viewers?: MapViewers;
      onError?: (error: unknown, characterId: number) => void;
      /** Where problems are kept for the owner to see; without it they are only reported. */
      problems?: TrackingProblemStore;
      /** A character's problem started or changed (null: it ended): once per change, not per poll. */
      onProblem?: (characterId: number, problem: PollProblem | null) => void;
    },
    private readonly actor: ActorRef = { kind: 'system', id: 'tracking' },
    options: PollerOptions = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** Polls the characters that are due, as far as concurrency and budget allow. */
  async tick(): Promise<void> {
    const now = this.deps.clock.now();
    this.startedAt ??= now;
    const characters = await this.trackedCharacters(now);
    for (const [id, state] of this.states)
      if (!characters.has(id)) {
        this.states.delete(id);
        // Not tracked anywhere any more: nothing to warn about.
        if (state.reported) void this.deps.problems?.clear(id).catch(() => undefined);
      }

    const due: Array<{ id: number; entries: TrackedCharacter[]; dueAt: number; viewed: boolean }> = [];
    for (const [id, entries] of characters) {
      if (this.inflight.has(id)) continue;
      const state = this.stateOf(id, now);
      const dueAt = Math.min(state.nextLocationAt, state.nextOnlineAt);
      if (dueAt > now) continue;
      const viewed = this.deps.viewers ? entries.some((e) => this.deps.viewers!.isViewed(e.mapId)) : false;
      due.push({ id, entries, dueAt, viewed });
    }
    // Viewed maps first, then the longest overdue.
    due.sort((a, b) => Number(b.viewed) - Number(a.viewed) || a.dueAt - b.dueAt);

    // Workers take the next due character as soon as they finish one, so throughput follows
    // ESI's answer times, not the tick rate; together with earlier ticks' workers they never
    // poll more than `concurrency` characters at once.
    let stop = false;
    const take = (): (typeof due)[number] | null => {
      while (!stop && due.length > 0) {
        const next = due.shift()!;
        if (this.inflight.has(next.id)) continue;
        // A later tick's worker may have polled it meanwhile.
        const state = this.stateOf(next.id, now);
        if (Math.min(state.nextLocationAt, state.nextOnlineAt) > this.deps.clock.now()) continue;
        const cost = this.requestsFor(this.stateOf(next.id, now), now);
        if (this.deps.budget && !this.deps.budget.tryTake(cost)) {
          stop = true;
          return null;
        }
        this.inflight.add(next.id);
        return next;
      }
      return null;
    };
    const worker = async () => {
      for (let next = take(); next; next = take()) {
        const { id, entries } = next;
        await this.poll(id, entries, now)
          .catch((error: unknown) => {
            const state = this.stateOf(id, now);
            state.nextLocationAt = state.nextOnlineAt = now + POLL_INTERVALS.noToken;
            this.deps.onError?.(error, id);
          })
          .finally(() => this.inflight.delete(id));
      }
    };
    const workers = Math.min(Math.max(0, this.options.concurrency - this.inflight.size), due.length);
    await Promise.all(Array.from({ length: workers }, worker));
  }

  /** Map access changed somewhere: check owners and the tracking accounts' roles again on the next tick. */
  recheckAccess(): void {
    for (const state of this.states.values()) state.accessCheckedAt = -Infinity;
  }

  /** Who is tracked changed: read the list again on the next tick. */
  trackingChanged(): void {
    this.tracked = null;
  }

  /** Characters polled at this moment (for tests and metrics). */
  get polling(): number {
    return this.inflight.size;
  }

  private async trackedCharacters(now: number): Promise<Map<number, TrackedCharacter[]>> {
    if (this.tracked && now - this.tracked.at < POLL_INTERVALS.tracked) return this.tracked.byCharacter;
    this.loadingTracked ??= this.deps.tracking
      .listTracked()
      .then((list) => {
        const byCharacter = new Map<number, TrackedCharacter[]>();
        for (const t of list) byCharacter.set(t.characterId, [...(byCharacter.get(t.characterId) ?? []), t]);
        this.tracked = { at: now, byCharacter };
        return byCharacter;
      })
      .finally(() => (this.loadingTracked = null));
    return this.loadingTracked;
  }

  /** ESI requests the next poll of this character makes. */
  private requestsFor(state: PollState, now: number): number {
    const online = state.nextOnlineAt <= now ? 1 : 0;
    const location = state.nextLocationAt <= now && state.online !== false ? 2 : 0;
    return Math.max(1, online + location);
  }

  private stateOf(characterId: number, now: number): PollState {
    let state = this.states.get(characterId);
    if (!state) {
      // Right after a start, first polls are spread out; characters tracked later start at once.
      const spread =
        now - (this.startedAt ?? now) < this.options.startupSpreadMs
          ? Math.floor(this.options.random() * this.options.startupSpreadMs)
          : 0;
      state = {
        nextLocationAt: now + spread,
        nextOnlineAt: now + spread,
        etags: {},
        online: null,
        locationSeenAt: null,
        accessCheckedAt: -Infinity,
        allowed: [],
        token: null,
        failing: {},
      };
      this.states.set(characterId, state);
    }
    return state;
  }

  private jitter(): number {
    return Math.floor(this.options.random() * this.options.jitterMs);
  }

  /**
   * The entries that may still be polled; the others are untracked. Ownership and roles are
   * checked once a minute (and after access changes), not on every poll.
   */
  private async allowed(id: number, entries: TrackedCharacter[], now: number): Promise<TrackedCharacter[]> {
    const state = this.stateOf(id, now);
    const sameEntries =
      state.allowed.length === entries.length &&
      entries.every((e) => state.allowed.some((a) => a.mapId === e.mapId && a.accountId === e.accountId));
    if (sameEntries && state.accessCheckedAt + POLL_INTERVALS.access > now) return state.allowed;

    const { characters, access } = this.deps;
    state.accessCheckedAt = now;
    const owner = await characters.character(id);
    let kept = entries.filter((e) => e.accountId === owner?.accountId);
    if (kept.length > 0) {
      const roles = await Promise.all(
        kept.map((e) => access.roleOf({ kind: 'account', id: e.accountId, instanceRole: 'user' }, e.mapId)),
      );
      kept = kept.filter((_, i) => hasMapRole(roles[i] ?? null, 'member'));
    }
    const dropped = entries.filter((e) => !kept.includes(e));
    await untrack(this.deps, dropped, this.actor, now);
    if (dropped.length > 0) this.trackingChanged();
    state.allowed = kept;
    return kept;
  }

  private async token(id: number, state: PollState, now: number): Promise<string | null> {
    if (state.token && state.token.until > now) return state.token.value;
    const value = await this.deps.characters.accessToken(id);
    state.token = value ? { value, until: now + POLL_INTERVALS.token } : null;
    return value;
  }

  private async poll(id: number, entries: TrackedCharacter[], now: number): Promise<void> {
    const { esi, characters, tracking } = this.deps;
    const state = this.stateOf(id, now);
    const kept = await this.allowed(id, entries, now);
    if (kept.length === 0) return;
    const accountId = kept[0]!.accountId;
    const mapIds = kept.map((e) => e.mapId);
    const token = await this.token(id, state, now);
    if (!token) {
      state.nextLocationAt = state.nextOnlineAt = now + POLL_INTERVALS.noToken;
      await this.report(id, state, NO_TOKEN, now);
      return;
    }
    const seen: Observation = { continuous: false };
    let asked = false;
    const answered = (route: keyof typeof ROUTE_SCOPES, result: EsiResult<unknown>) => {
      const answer = problemOf(route, result);
      if (answer === 'unknown') return;
      asked = true;
      if (answer === 'ok') delete state.failing[route];
      else state.failing[route] = answer;
    };

    if (state.nextOnlineAt <= now) {
      const online = await esi.online(id, token, state.etags.online);
      answered('online', online);
      if (online.ok) {
        state.etags.online = online.etag ?? undefined;
        state.nextOnlineAt = Math.max(now + POLL_INTERVALS.online, online.expiresAt) + this.jitter();
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
      answered('location', location);
      answered('ship', ship);
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
      state.nextLocationAt = next + this.jitter();
    }

    if (asked) {
      const { location, ship, online } = state.failing;
      await this.report(id, state, location ?? ship ?? online ?? null, now);
    }

    // Nothing new from ESI (304s, refusals): nothing can have changed.
    if (seen.online === undefined && !seen.location && !seen.ship) return;

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
              ...(change.type === 'character.ship_changed'
                ? { before: { shipTypeId: presence.shipTypeId, shipName: presence.shipName } }
                : {}),
            }),
          ),
        ),
      );
    });
  }

  /**
   * Tells the owner (and the log) when a character's problem starts, changes or ends, once per
   * change. Keeping it must not stop the poll: a failed write is tried again on the next one.
   */
  private async report(
    id: number,
    state: PollState,
    problem: PollProblem | null,
    now: number,
  ): Promise<void> {
    const before = state.reported;
    if (before !== undefined && (before?.message ?? null) === (problem?.message ?? null)) return;
    try {
      if (problem && problem.kind !== 'sign-in')
        await this.deps.problems?.set({
          characterId: id,
          kind: problem.kind,
          message: problem.message,
          since: now,
        });
      else await this.deps.problems?.clear(id);
    } catch {
      return;
    }
    state.reported = problem;
    // A clean first poll after a start is not news.
    if (problem || before) this.deps.onProblem?.(id, problem);
  }
}
