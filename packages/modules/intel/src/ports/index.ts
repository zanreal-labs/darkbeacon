import type { SystemIntelDto } from '@darkbeacon/shared';
import type { ActivityHour, ActivityKind } from '../domain/activity.js';
import type { Killmail } from '../domain/killmail.js';
import type { SovereigntyClaim, SpaceFacts } from '../domain/sovereignty.js';
import type { Contact } from '../domain/standings.js';

export type { Clock, EventLog, MapAccess } from '@darkbeacon/core';

/**
 * The answer of an outside source. Adapters never throw for an unavailable source: they say when
 * to ask again (rate limits, error limits, 5xx backoff), and the jobs simply wait until then.
 */
export type SourceResult<T> =
  | { ok: true; data: T; /** When the source has something new (its cache expiry). */ nextAt: number }
  | { ok: false; retryAt: number; reason: string };

/** ESI's public hourly figures: `GET /universe/system_kills` and `GET /universe/system_jumps`. */
export interface ActivitySource {
  systemKills(): Promise<
    SourceResult<{
      /** Start of the hour the figures describe. */
      hour: number;
      rows: Array<{ systemId: number; shipKills: number; podKills: number; npcKills: number }>;
    } | null>
  >;
  systemJumps(): Promise<
    SourceResult<{ hour: number; rows: Array<{ systemId: number; jumps: number }> } | null>
  >;
}

/** ESI's sovereignty claims (`GET /sovereignty/systems`). Data is null when unchanged (304). */
export interface SovereigntySource {
  claims(): Promise<SourceResult<Array<{ systemId: number; claim: SovereigntyClaim }> | null>>;
}

/** zKillboard's recent killmails of one system (its API), at most `pastSeconds` old. */
export interface KillHistory {
  recent(
    systemId: number,
    pastSeconds: number,
  ): Promise<SourceResult<{ kills: Killmail[]; capped: boolean }>>;
}

/** zKillboard's live feed of every new killmail (R2Z2). */
export interface KillFeed {
  /**
   * Runs until stopped: asks `wanted()` before reading on (it idles while nothing is wanted) and
   * hands every killmail to `onKill`.
   */
  start(handlers: {
    wanted(): Promise<boolean>;
    onKill(kill: Killmail): Promise<void>;
    /** The feed answered (also when nothing was new): it is live. */
    onAlive(): void;
    onError(error: unknown): void;
  }): void;
  stop(): Promise<void>;
}

export interface ResolvedName {
  id: number;
  name: string;
  category: string;
}

/**
 * ESI's names: `POST /universe/names` for anything (characters, corporations, alliances, factions,
 * ship types) and the tickers of corporations and alliances.
 */
export interface NameResolver {
  /** Unknown ids are left out; throws when ESI cannot be asked. */
  names(ids: readonly number[]): Promise<ResolvedName[]>;
  /** Null when ESI does not know it; throws when ESI cannot be asked. */
  ticker(category: 'corporation' | 'alliance', id: number): Promise<string | null>;
}

export interface StoredName {
  id: number;
  name: string;
  category: string;
  /** Undefined: not looked up yet (corporations and alliances only). */
  ticker?: string | null;
  updatedAt: number;
}

/** Which systems the intel follows: the ones on maps. */
export interface IntelSystems {
  /** Every system on any map (hidden ones included). */
  watched(): Promise<Set<number>>;
  /**
   * The systems a map's viewers see (the merged chain on maps that merge others), hidden ones
   * flagged; null when there is no such map.
   */
  onMap(mapId: string): Promise<Array<{ id: number; visible: boolean }> | null>;
  /** Maps that show the system (visible on the map, or in its merged chain). */
  mapsShowing(systemId: number): Promise<string[]>;
}

/** Static facts of a system (from the universe catalog). */
export interface IntelUniverse {
  space(systemId: number): SpaceFacts | null;
  /** Every known system (for region totals). */
  all(): Iterable<{ id: number; space: SpaceFacts }>;
}

/** Ephemeral pushes to the viewers of a map (the realtime gateway). */
export interface IntelPublisher {
  /** Maps someone follows right now; nobody else needs a push. */
  followedMaps(): string[];
  push(mapId: string, update: { systems: SystemIntelDto[] }): void;
}

/** Measurements (OpenTelemetry when the operator turned it on). */
export interface IntelMetrics {
  /** One request to zKillboard: `r2z2` (the feed) or `api`, and its outcome (`2xx`, `404`, `error`...). */
  zkillRequest(endpoint: 'r2z2' | 'api', outcome: string): void;
  /** Killmails stored, by where they came from. */
  killsStored(source: 'feed' | 'history', count: number): void;
}

export interface IntelRepository {
  // Sovereignty
  /** Replaces every claim; returns the systems whose claim changed. */
  replaceClaims(
    claims: ReadonlyArray<{ systemId: number; claim: SovereigntyClaim }>,
    at: number,
  ): Promise<number[]>;
  claims(systemIds: readonly number[]): Promise<Map<number, SovereigntyClaim>>;
  allClaims(): Promise<Map<number, SovereigntyClaim>>;

  // Hourly activity
  /** Stores one hour of one kind for every listed system and remembers the hour as answered. */
  saveHour(
    kind: ActivityKind,
    hour: number,
    rows: ReadonlyArray<Pick<ActivityHour, 'systemId'> & Partial<Omit<ActivityHour, 'systemId' | 'hour'>>>,
  ): Promise<void>;
  /** Hours ESI answered for, per kind, from `since` on. */
  answeredHours(since: number): Promise<{ kills: Set<number>; jumps: Set<number> }>;
  activity(systemIds: readonly number[], since: number): Promise<ActivityHour[]>;
  pruneActivity(before: number): Promise<void>;

  // Killmails
  /** Stores killmails not stored yet; returns the new ones. */
  addKills(kills: readonly Killmail[]): Promise<Killmail[]>;
  /** A system's killmails from `since` on, newest first. */
  kills(systemId: number, since: number, limit?: number): Promise<Killmail[]>;
  /** Killmails of several systems from `since` on, newest first. */
  killsIn(systemIds: readonly number[], since: number, limit: number): Promise<Killmail[]>;
  /** Killmails from `since` on and the newest kill time, per system. */
  killCounts(
    systemIds: readonly number[],
    since: number,
  ): Promise<Map<number, { count: number; last: number | null }>>;
  /** Newest kill time per system, whatever its age. */
  lastKills(systemIds: readonly number[]): Promise<Map<number, number>>;
  pruneKills(before: number): Promise<void>;

  // Since when a system's killmails are complete (fetched from zKillboard's history, then live)
  coverage(systemIds: readonly number[]): Promise<Map<number, { since: number; at: number }>>;
  setCoverage(systemId: number, coverage: { since: number; at: number }): Promise<void>;
  /** Forgets the coverage of these systems (of every system without ids). */
  dropCoverage(systemIds?: readonly number[]): Promise<void>;

  // Names
  names(ids: readonly number[]): Promise<Map<number, StoredName>>;
  saveNames(names: readonly StoredName[]): Promise<void>;
  pruneNames(before: number): Promise<void>;

  // Small values: the feed's position, when sources may be asked again
  state<T>(key: string): Promise<T | null>;
  setState(key: string, value: unknown): Promise<void>;
}

/** An account's linked characters as identity knows them (main first). */
export interface StandingPilots {
  characters(
    accountId: string,
  ): Promise<Array<{ id: number; corporationId: number; allianceId: number | null; scopes: string[] }>>;
  accessToken(characterId: number): Promise<string | null>;
}

/**
 * ESI contacts (`GET /characters/{id}/contacts`, `/corporations/{id}/contacts`,
 * `/alliances/{id}/contacts`), read with a character's token.
 */
export interface ContactsSource {
  contacts(
    owner: { kind: 'character' | 'corporation' | 'alliance'; id: number },
    accessToken: string,
  ): Promise<SourceResult<Contact[]>>;
}
