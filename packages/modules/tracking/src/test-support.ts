// In-memory ports for the module's own tests. Not part of the public API.
import type { DomainEvent, MapRole, NewEvent } from '@darkbeacon/core';
import type { CharacterPresence, TrackedCharacter } from './domain/presence.js';
import type {
  CharacterTokenSource,
  EsiGateway,
  EsiLocation,
  EsiOnline,
  EsiResult,
  EsiShip,
  EventLog,
  MapAccess,
  TrackingProblem,
  TrackingProblemStore,
  TrackingRepository,
  UnitOfWork,
} from './ports/index.js';

export class MemoryTrackingRepository implements TrackingRepository {
  tracked: TrackedCharacter[] = [];
  presence = new Map<number, CharacterPresence>();

  listTracked = () => Promise.resolve([...this.tracked]);
  listTrackedOnMap = (mapId: string) => Promise.resolve(this.tracked.filter((t) => t.mapId === mapId));
  findTracked = (mapId: string, characterId: number) =>
    Promise.resolve(this.tracked.find((t) => t.mapId === mapId && t.characterId === characterId) ?? null);

  setTracked(entry: TrackedCharacter, tracked: boolean): Promise<void> {
    this.tracked = this.tracked.filter((t) => t.mapId !== entry.mapId || t.characterId !== entry.characterId);
    if (tracked) this.tracked.push(entry);
    return Promise.resolve();
  }

  untrackMap(mapId: string): Promise<void> {
    this.tracked = this.tracked.filter((t) => t.mapId !== mapId);
    return Promise.resolve();
  }

  getPresence = (id: number) => Promise.resolve(this.presence.get(id) ?? null);
  listPresence = (ids: readonly number[]) =>
    Promise.resolve(ids.flatMap((id) => (this.presence.has(id) ? [this.presence.get(id)!] : [])));

  savePresence(p: CharacterPresence): Promise<void> {
    this.presence.set(p.characterId, { ...p });
    return Promise.resolve();
  }

  deletePresence(characterId: number): Promise<void> {
    this.presence.delete(characterId);
    return Promise.resolve();
  }
}

export class MemoryTrackingProblems implements TrackingProblemStore {
  problems = new Map<number, TrackingProblem>();

  set(problem: TrackingProblem): Promise<void> {
    this.problems.set(problem.characterId, { ...problem });
    return Promise.resolve();
  }

  clear(characterId: number): Promise<void> {
    this.problems.delete(characterId);
    return Promise.resolve();
  }

  list(characterIds: readonly number[]): Promise<TrackingProblem[]> {
    return Promise.resolve(
      characterIds.flatMap((id) => (this.problems.has(id) ? [this.problems.get(id)!] : [])),
    );
  }
}

export class MemoryEventLog implements EventLog {
  events: DomainEvent[] = [];

  append(events: readonly NewEvent[]): Promise<DomainEvent[]> {
    const stored = events.map((e) => ({
      ...e,
      seq: this.events.filter((x) => x.stream === e.stream).length + 1,
      v: 1 as const,
    }));
    this.events.push(...stored);
    return Promise.resolve(stored);
  }

  readSince = () => Promise.resolve([]);
  headSeq = () => Promise.resolve(0);
  oldestSeq = () => Promise.resolve(null);
  prune = () => Promise.resolve(0);

  /** `type` and `data` of the stored events, for compact assertions. */
  summary(stream?: string) {
    return this.events
      .filter((e) => !stream || e.stream === stream)
      .map(({ type, data }) => ({ type, data }));
  }
}

export const passThroughUow: UnitOfWork = { transaction: (work) => work() };

/** Grants `roles[mapId][accountId]`. */
export function fakeAccess(roles: Record<string, Record<string, MapRole>>): MapAccess {
  return {
    roleOf: (actor, mapId) => Promise.resolve(roles[mapId]?.[actor.id] ?? null),
    mapsFor: () => Promise.resolve([]),
  };
}

export function fakeCharacters(
  characters: Record<number, { name: string; accountId: string; token?: string | null }>,
): CharacterTokenSource {
  return {
    character: (id) => {
      const c = characters[id];
      return Promise.resolve(c ? { name: c.name, accountId: c.accountId } : null);
    },
    accessToken: (id) => {
      const c = characters[id];
      return Promise.resolve(c ? (c.token === undefined ? `token-${id}` : c.token) : null);
    },
  };
}

type Answer<T> = EsiResult<T> | ((etag: string | undefined) => EsiResult<T>);

/** Scriptable ESI: set what each endpoint answers; every call is recorded. */
export class FakeEsi implements EsiGateway {
  calls: Array<{ route: 'location' | 'ship' | 'online'; characterId: number; etag?: string }> = [];
  answers = {
    location: new Map<number, Answer<EsiLocation>>(),
    ship: new Map<number, Answer<EsiShip>>(),
    online: new Map<number, Answer<EsiOnline>>(),
  };

  constructor(
    private readonly expiresIn = 5_000,
    private readonly now: () => number = () => 0,
  ) {}

  /** Answers 200 with `data` and an ETag derived from it. */
  set(
    characterId: number,
    values: { location?: number; docked?: boolean; ship?: number; shipName?: string; online?: boolean },
  ): void {
    const ok =
      <T>(data: T): Answer<T> =>
      (etag) => {
        const tag = JSON.stringify(data);
        return {
          ok: true,
          data: etag === tag ? null : data,
          etag: tag,
          expiresAt: this.now() + this.expiresIn,
        };
      };
    if (values.location !== undefined) {
      this.answers.location.set(
        characterId,
        ok({ solarSystemId: values.location, stationId: values.docked ? 60003760 : null, structureId: null }),
      );
    }
    if (values.ship !== undefined) {
      this.answers.ship.set(
        characterId,
        ok({ shipTypeId: values.ship, shipItemId: 1, shipName: values.shipName ?? 'Ship' }),
      );
    }
    if (values.online !== undefined) {
      this.answers.online.set(characterId, ok({ online: values.online, lastLogin: null }));
    }
  }

  location = (id: number, _token: string, etag?: string) => this.answer('location', id, etag);
  ship = (id: number, _token: string, etag?: string) => this.answer('ship', id, etag);
  online = (id: number, _token: string, etag?: string) => this.answer('online', id, etag);

  count(route: 'location' | 'ship' | 'online', characterId?: number): number {
    return this.calls.filter(
      (c) => c.route === route && (characterId === undefined || c.characterId === characterId),
    ).length;
  }

  private answer<R extends 'location' | 'ship' | 'online'>(route: R, characterId: number, etag?: string) {
    this.calls.push({ route, characterId, ...(etag ? { etag } : {}) });
    const answer = this.answers[route].get(characterId) as Answer<unknown> | undefined;
    const result: EsiResult<unknown> = !answer
      ? { ok: false, retryAt: this.now() + 60_000, reason: 'no answer scripted' }
      : typeof answer === 'function'
        ? answer(etag)
        : answer;
    return Promise.resolve(result as never);
  }
}
