import { parseStream, type Clock, type DomainEvent } from '@darkbeacon/core';
import type {
  AccessRule,
  AccessRuleRepository,
  AccessSubjects,
  AccessSubjectsSource,
  MapOwnership,
} from '@darkbeacon/access';
import { isEventOfType } from '@darkbeacon/shared';

/**
 * How long an access fact is reused without hearing of a change. Changes that come with an event
 * (rules, linked characters, corporations, Discord roles, sessions, maps) drop it at once; the
 * TTL bounds anything that changes without one.
 */
export const ACCESS_CACHE_TTL_MS = 10_000;
const MAX_ENTRIES = 20_000;

/** A small map with expiry; the oldest entries go first when it is full. */
class Ttl<V> {
  private readonly entries = new Map<string, { value: Promise<V>; until: number }>();

  constructor(
    private readonly clock: Clock,
    private readonly ttlMs: number,
  ) {}

  get(key: string, load: () => Promise<V>): Promise<V> {
    const now = this.clock.now();
    const hit = this.entries.get(key);
    if (hit && hit.until > now) return hit.value;
    const value = load();
    this.entries.set(key, { value, until: now + this.ttlMs });
    if (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
    // A failed read is not kept.
    value.catch(() => this.entries.delete(key));
    return value;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

export interface AccessCacheOptions {
  clock: Clock;
  /** Inside a transaction every read goes to the database: it may see its own writes. */
  inTransaction: () => boolean;
  ttlMs?: number;
}

/**
 * Caches what map authorization reads on every request and every socket re-check: a map's
 * access rules, an account's subjects (characters, corporations, alliances, Discord roles) and
 * map owners. Feed it every event (`onEvent`, from the event bus, so other processes' changes
 * count too); it forgets what an event says changed.
 */
export class AccessCache {
  private readonly rules: Ttl<AccessRule[]>;
  private readonly subjects: Ttl<AccessSubjects>;
  private readonly owners: Ttl<string | null>;

  constructor(private readonly options: AccessCacheOptions) {
    const ttl = options.ttlMs ?? ACCESS_CACHE_TTL_MS;
    this.rules = new Ttl(options.clock, ttl);
    this.subjects = new Ttl(options.clock, ttl);
    this.owners = new Ttl(options.clock, ttl);
  }

  /** The rule repository, with `listForMap` cached and writes dropping their map. */
  ruleRepository(inner: AccessRuleRepository): AccessRuleRepository {
    return {
      listForMap: (mapId) =>
        this.options.inTransaction()
          ? inner.listForMap(mapId)
          : this.rules.get(mapId, () => inner.listForMap(mapId)),
      findById: (ruleId) => inner.findById(ruleId),
      insert: async (rule) => {
        this.rules.delete(rule.mapId);
        await inner.insert(rule);
      },
      delete: async (ruleId) => {
        const rule = await inner.findById(ruleId);
        if (rule) this.rules.delete(rule.mapId);
        await inner.delete(ruleId);
      },
      listMatching: (subjects) => inner.listMatching(subjects),
      discordGuildIds: () => inner.discordGuildIds(),
    };
  }

  subjectsSource(inner: AccessSubjectsSource): AccessSubjectsSource {
    return {
      subjectsOf: (accountId) =>
        this.options.inTransaction()
          ? inner.subjectsOf(accountId)
          : this.subjects.get(accountId, () => inner.subjectsOf(accountId)),
    };
  }

  ownership(inner: MapOwnership): MapOwnership {
    return {
      ownerOf: (mapId) =>
        this.options.inTransaction()
          ? inner.ownerOf(mapId)
          : this.owners.get(mapId, () => inner.ownerOf(mapId)),
      mapsOwnedBy: (accountId) => inner.mapsOwnedBy(accountId),
    };
  }

  onEvent(event: DomainEvent): void {
    if (isEventOfType(event, 'access.account_changed')) {
      this.subjects.delete(event.data.accountId);
      return;
    }
    const stream = parseStream(event.stream);
    if (event.type.startsWith('access.')) {
      // A rule on a map, or something instance-wide (roles): drop the map, or everything.
      if (stream?.kind === 'map') this.rules.delete(stream.id);
      else {
        this.rules.clear();
        this.subjects.clear();
      }
    } else if (event.type === 'map.created' || event.type === 'map.removed') {
      if (stream?.kind === 'map') {
        this.owners.delete(stream.id);
        this.rules.delete(stream.id);
      }
    } else if (event.type === 'character.unlinked' || event.type === 'character.linked') {
      this.subjects.clear();
    }
  }
}
