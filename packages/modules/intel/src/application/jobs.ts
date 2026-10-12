import { actorRef, mapStream, newEvent, type Actor, type Clock, type EventLog } from '@darkbeacon/core';
import { DAY, HOUR, MINUTE } from '../domain/activity.js';
import type { Killmail } from '../domain/killmail.js';
import type {
  ActivitySource,
  IntelMetrics,
  IntelPublisher,
  IntelRepository,
  IntelSystems,
  KillFeed,
  KillHistory,
  SovereigntySource,
} from '../ports/index.js';
import type { IntelQueries } from './queries.js';

export const DEFAULT_KILL_DAYS = 7;
/** zKillboard's API gives at most a week (`pastSeconds` up to 604 800). */
const HISTORY_SECONDS = 7 * 24 * 3600;
/** One history request at a time, at least this far apart (zKillboard asks to be gentle). */
const HISTORY_GAP = 2_000;
/** Without an answer from the feed for this long it is not live. */
const LIVE_FOR = 2 * MINUTE;
/** The feed resumes where it stopped if that is this recent (R2Z2 keeps files for a day). */
const RESUME_WITHIN = 6 * HOUR;
/** Killmails older than this when they arrive are stored but not announced (catching up). */
const ANNOUNCE_WITHIN = 10 * MINUTE;
/** Which systems are on maps is read again at least this often. */
const WATCHED_TTL = 30_000;
const MIN_REFRESH = MINUTE;

const INTEL: Actor = { kind: 'system', id: 'intel' };

export interface IntelJobsDeps {
  repo: IntelRepository;
  queries: IntelQueries;
  systems: IntelSystems;
  publisher: IntelPublisher;
  /** New live killmails become `kill.reported` events on every map showing their system. */
  events: EventLog;
  clock: Clock;
  /** Sources that are switched on; a missing one is never asked. */
  activity?: ActivitySource;
  sovereignty?: SovereigntySource;
  history?: KillHistory;
  feed?: KillFeed;
  metrics?: IntelMetrics | null;
  /** Killmails are kept this many days (default 7). */
  killDays?: number;
  onError?: (job: string, error: unknown) => void;
}

/**
 * Keeps intel current for every system on any map, once per system whatever the number of maps:
 * ESI's sovereignty and hourly figures when their caches expire, zKillboard's history of a system
 * when it first appears on a map, its live feed for everything after; tells the maps' viewers what
 * changed. `tick()` runs whatever is due; the server calls it every few seconds.
 */
export class IntelJobs {
  private readonly due = { sovereignty: 0, kills: 0, jumps: 0, history: 0, prune: 0, alive: 0 };
  private readonly queue: number[] = [];
  private watched: { ids: Set<number>; at: number } | null = null;
  private readonly onMap = new Map<string, { ids: Set<number>; at: number }>();
  private lastAlive = -Infinity;
  private started = false;
  private ticking: Promise<void> | null = null;

  constructor(private readonly deps: IntelJobsDeps) {}

  /** Whether killmails arrive live (the feed answered within the last two minutes). */
  live(): boolean {
    return this.deps.feed !== undefined && this.deps.clock.now() - this.lastAlive < LIVE_FOR;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const { repo, feed, clock } = this.deps;
    if (feed) {
      // Killmails since the feed last ran are lost unless it resumes from its position; then every
      // system's history is fetched again.
      const aliveAt = await repo.state<number>('feed:alive');
      if (aliveAt === null || clock.now() - aliveAt > RESUME_WITHIN) await repo.dropCoverage();
      feed.start({
        wanted: async () => (await this.watchedSystems()).size > 0,
        onKill: (kill) => this.ingest([kill], 'feed'),
        onAlive: () => {
          this.lastAlive = this.deps.clock.now();
        },
        onError: (error) => this.deps.onError?.('feed', error),
      });
    }
    await this.systemsChanged();
  }

  async stop(): Promise<void> {
    this.started = false;
    await this.deps.feed?.stop();
    await this.ticking;
  }

  /** Runs every job that is due, one tick at a time. */
  tick(): Promise<void> {
    this.ticking ??= this.runDue().finally(() => (this.ticking = null));
    return this.ticking;
  }

  /**
   * Systems were added to or removed from a map: forgets what it knew of the maps' systems,
   * queues the history of systems new to the instance and forgets the coverage of systems no map
   * holds any more (the feed skips them, so their killmails have a gap from now on).
   */
  async systemsChanged(mapId?: string): Promise<void> {
    if (mapId) this.onMap.delete(mapId);
    else this.onMap.clear();
    const before = this.watched?.ids ?? null;
    this.watched = null;
    const now = await this.watchedSystems();
    if (before) {
      const gone = [...before].filter((id) => !now.has(id));
      if (gone.length > 0) await this.deps.repo.dropCoverage(gone);
    }
    if (!this.deps.history) return;
    const coverage = await this.deps.repo.coverage([...now]);
    for (const id of now) {
      if (!coverage.has(id) && !this.queue.includes(id)) this.queue.push(id);
    }
  }

  private async watchedSystems(): Promise<Set<number>> {
    const now = this.deps.clock.now();
    if (this.watched && now - this.watched.at < WATCHED_TTL) return this.watched.ids;
    this.watched = { ids: await this.deps.systems.watched(), at: now };
    return this.watched.ids;
  }

  private async runDue(): Promise<void> {
    const now = this.deps.clock.now();
    const jobs: Array<[keyof IntelJobs['due'], () => Promise<number>]> = [
      ['sovereignty', () => this.refreshSovereignty()],
      ['kills', () => this.refreshActivity('kills')],
      ['jumps', () => this.refreshActivity('jumps')],
      ['history', () => this.fetchHistory()],
      ['prune', () => this.prune()],
      ['alive', () => this.rememberAlive()],
    ];
    for (const [name, job] of jobs) {
      if (now < this.due[name]) continue;
      try {
        this.due[name] = await job();
      } catch (error) {
        this.deps.onError?.(name, error);
        this.due[name] = now + 5 * MINUTE;
      }
    }
  }

  private next(at: number): number {
    return Math.max(at, this.deps.clock.now() + MIN_REFRESH);
  }

  private async refreshSovereignty(): Promise<number> {
    const source = this.deps.sovereignty;
    if (!source) return Infinity;
    const result = await source.claims();
    if (!result.ok) return result.retryAt;
    if (result.data) {
      const changed = await this.deps.repo.replaceClaims(result.data, this.deps.clock.now());
      if (changed.length > 0) this.deps.queries.claimsChanged();
      const watched = await this.watchedSystems();
      await this.publish(changed.filter((id) => watched.has(id)));
    }
    return this.next(result.nextAt);
  }

  private async refreshActivity(kind: 'kills' | 'jumps'): Promise<number> {
    const source = this.deps.activity;
    if (!source) return Infinity;
    const result = kind === 'kills' ? await source.systemKills() : await source.systemJumps();
    if (!result.ok) return result.retryAt;
    if (result.data) {
      const { hour, rows } = result.data;
      const known = await this.deps.repo.answeredHours(hour);
      const fresh = !(kind === 'kills' ? known.kills : known.jumps).has(hour);
      await this.deps.repo.saveHour(kind, hour, rows);
      // A new hour changes the figures of every system; the same hour again changes nothing.
      if (fresh) await this.publish([...(await this.watchedSystems())]);
    }
    return this.next(result.nextAt);
  }

  /** The history of one queued system per run. */
  private async fetchHistory(): Promise<number> {
    const history = this.deps.history;
    const now = this.deps.clock.now();
    if (!history) return Infinity;
    const watched = await this.watchedSystems();
    let systemId: number | undefined;
    while ((systemId = this.queue[0]) !== undefined && !watched.has(systemId)) this.queue.shift();
    if (systemId === undefined) return now + HISTORY_GAP;
    const result = await history.recent(systemId, HISTORY_SECONDS);
    if (!result.ok) return Math.max(result.retryAt, now + HISTORY_GAP);
    this.queue.shift();
    await this.ingest(result.data.kills, 'history');
    const oldest = Math.min(...result.data.kills.map((k) => k.time));
    await this.deps.repo.setCoverage(systemId, {
      since: result.data.capped && Number.isFinite(oldest) ? oldest : now - HISTORY_SECONDS * 1000,
      at: now,
    });
    await this.publish([systemId]);
    return now + HISTORY_GAP;
  }

  private async prune(): Promise<number> {
    const now = this.deps.clock.now();
    const { repo } = this.deps;
    await repo.pruneKills(now - (this.deps.killDays ?? DEFAULT_KILL_DAYS) * DAY);
    await repo.pruneActivity(now - 26 * HOUR);
    await repo.pruneNames(now - 30 * DAY);
    return now + HOUR;
  }

  private async rememberAlive(): Promise<number> {
    if (this.live()) await this.deps.repo.setState('feed:alive', this.lastAlive);
    return this.deps.clock.now() + MINUTE;
  }

  /**
   * Stores killmails of watched systems. A new one from the live feed that is fresh is reported
   * on every map showing its system (`kill.reported`: the map's viewers, webhooks and plugins
   * such as the Discord notifier); viewers also get the system's new counts.
   */
  private async ingest(kills: readonly Killmail[], source: 'feed' | 'history'): Promise<void> {
    if (kills.length === 0) return;
    const watched = await this.watchedSystems();
    const wanted = kills.filter((k) => watched.has(k.systemId));
    if (wanted.length === 0) return;
    const added = await this.deps.repo.addKills(wanted);
    if (added.length === 0) return;
    this.deps.metrics?.killsStored(source, added.length);
    if (source !== 'feed') return;
    const now = this.deps.clock.now();
    for (const kill of added) {
      if (now - kill.time <= ANNOUNCE_WITHIN) {
        const maps = await this.deps.systems.mapsShowing(kill.systemId);
        if (maps.length > 0) {
          const dto = await this.deps.queries.killmail(kill);
          await this.deps.events.append(
            maps.map((mapId) =>
              newEvent({
                stream: mapStream(mapId),
                type: 'kill.reported',
                actor: actorRef(INTEL),
                data: dto,
                occurredAt: now,
              }),
            ),
          );
        }
      }
      await this.publish([kill.systemId]);
    }
  }

  /** Tells the viewers of every followed map holding one of these systems what they look like now. */
  private async publish(systemIds: readonly number[]): Promise<void> {
    if (systemIds.length === 0) return;
    const changed = new Set(systemIds);
    const targets: Array<[string, number[]]> = [];
    for (const mapId of this.deps.publisher.followedMaps()) {
      const ids = await this.mapSystems(mapId);
      const hit = [...changed].filter((id) => ids.has(id));
      if (hit.length > 0) targets.push([mapId, hit]);
    }
    if (targets.length === 0) return;
    const intel = new Map(
      (await this.deps.queries.intelFor([...new Set(targets.flatMap(([, ids]) => ids))])).map((i) => [
        i.solarSystemId,
        i,
      ]),
    );
    for (const [mapId, ids] of targets) {
      this.deps.publisher.push(mapId, { systems: ids.map((id) => intel.get(id)!) });
    }
  }

  private async mapSystems(mapId: string): Promise<Set<number>> {
    const now = this.deps.clock.now();
    const cached = this.onMap.get(mapId);
    if (cached && now - cached.at < WATCHED_TTL) return cached.ids;
    const ids = new Set(((await this.deps.systems.onMap(mapId)) ?? []).map((s) => s.id));
    this.onMap.set(mapId, { ids, at: now });
    return ids;
  }
}
