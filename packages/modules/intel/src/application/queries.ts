import { NotFoundError, requireMapRole, type Actor, type Clock, type MapAccess } from '@darkbeacon/core';
import type {
  ActiveGroupDto,
  MapKillsDto,
  MapKillsQuery,
  ActivityWindow,
  KillmailDto,
  KillParticipantDto,
  MapIntelDto,
  SovereigntyDto,
  SystemActivityDto,
  SystemIntelDto,
} from '@darkbeacon/shared';
import { activitySeries, DAY, HOUR, killsLastHour, lastHours, latestHour } from '../domain/activity.js';
import { activeGroups, type ActiveGroup } from '../domain/groups.js';
import { killmailIds, type KillParty, type Killmail } from '../domain/killmail.js';
import {
  isNullSec,
  isWormholeSpace,
  regionHolders,
  shownClaim,
  type RegionHolder,
  type SovereigntyClaim,
} from '../domain/sovereignty.js';
import type { IntelRepository, IntelSystems, IntelUniverse } from '../ports/index.js';
import { entityOf, type IntelNames, type NameBook } from './names.js';

/** Killmails the sidebar lists. */
export const RECENT_KILLS = 20;
/** Killmails read for "who is active" over the longest window. */
const GROUP_KILLS = 2_000;
const WINDOWS: Record<ActivityWindow, number> = { '1h': HOUR, '24h': DAY, '7d': 7 * DAY };

export interface IntelQueriesDeps {
  repo: IntelRepository;
  names: IntelNames;
  systems: IntelSystems;
  universe: IntelUniverse;
  access: MapAccess;
  clock: Clock;
  /** Whether zKillboard's live feed is running (counts of the last hour are then complete). */
  live(): boolean;
}

/** What maps show of their systems' intel. Reads only; the jobs keep the data current. */
/** Region holders are worked out from every claim; sovereignty changes slowly. */
const REGION_TTL = 5 * 60_000;

export class IntelQueries {
  private regions: { holders: Map<string, RegionHolder>; at: number } | null = null;

  constructor(private readonly deps: IntelQueriesDeps) {}

  /** Forgets the region holders (new claims arrived). */
  claimsChanged(): void {
    this.regions = null;
  }

  private async regionHolders(): Promise<Map<string, RegionHolder>> {
    const now = this.deps.clock.now();
    if (this.regions && now - this.regions.at < REGION_TTL) return this.regions.holders;
    const holders = regionHolders(this.deps.universe.all(), await this.deps.repo.allClaims());
    this.regions = { holders, at: now };
    return holders;
  }

  /** Sovereignty and the last hour of every system on the map (viewer). */
  async mapIntel(actor: Actor | null, mapId: string): Promise<MapIntelDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'viewer');
    const systems = await this.deps.systems.onMap(mapId);
    if (!systems) throw new NotFoundError('Map');
    return { systems: await this.intelFor(systems.map((s) => s.id)), live: this.deps.live() };
  }

  /** One system on the map: hourly series, recent killmails, who is active (viewer). */
  async systemActivity(actor: Actor | null, mapId: string, systemId: number): Promise<SystemActivityDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'viewer');
    const systems = await this.deps.systems.onMap(mapId);
    if (!systems?.some((s) => s.id === systemId)) throw new NotFoundError('System');
    const { repo, clock } = this.deps;
    const now = clock.now();
    const hours = lastHours(now - HOUR, 24);
    const [intel, rows, answered, kills, coverage] = await Promise.all([
      this.intelFor([systemId]),
      repo.activity([systemId], hours[0]!),
      repo.answeredHours(hours[0]!),
      repo.kills(systemId, now - WINDOWS['7d'], GROUP_KILLS),
      repo.coverage([systemId]),
    ]);
    const recent = kills.slice(0, RECENT_KILLS);
    const wormhole = isWormholeSpace(this.deps.universe.space(systemId));
    const groups = Object.fromEntries(
      (Object.keys(WINDOWS) as ActivityWindow[]).map((w) => [w, activeGroups(kills, now - WINDOWS[w])]),
    ) as Record<ActivityWindow, ActiveGroup[]>;
    const groupIds = Object.values(groups).flatMap((list) => list.map((g) => g.id));
    const recentIds = recent.flatMap(killmailIds);
    const book = await this.deps.names.lookup(
      [...recentIds, ...groupIds],
      [...groupIds, ...recent.flatMap(tickerIds)],
    );
    const group = (g: ActiveGroup): ActiveGroupDto => ({
      kind: g.kind,
      entity: entityOf(g.id, book)!,
      kills: g.kills,
      losses: g.losses,
    });
    return {
      intel: intel[0]!,
      hours: activitySeries(systemId, rows, answered, hours).map(({ systemId: _, ...h }) => {
        const since = coverage.get(systemId)?.since;
        const killmails =
          since !== undefined && since <= h.hour
            ? kills.filter((k) => k.time >= h.hour && k.time < h.hour + HOUR).length
            : null;
        // ESI counts nothing in wormhole space: no figures rather than zeros.
        return wormhole
          ? { ...h, shipKills: null, podKills: null, npcKills: null, jumps: null, killmails }
          : { ...h, killmails };
      }),
      kills: recent.map((k) => killDto(k, book)),
      groups: {
        '1h': groups['1h'].map(group),
        '24h': groups['24h'].map(group),
        '7d': groups['7d'].map(group),
      },
      coveredSince: coverage.get(systemId)?.since ?? null,
    };
  }

  /**
   * Killmails of the map's visible systems (viewer), newest first: all of them, the given ones
   * (others are ignored) or those in wormhole space.
   */
  async mapKills(actor: Actor | null, mapId: string, query: MapKillsQuery): Promise<MapKillsDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'viewer');
    const systems = await this.deps.systems.onMap(mapId);
    if (!systems) throw new NotFoundError('Map');
    const wanted = query.systems ? new Set(query.systems) : null;
    const ids = systems
      .filter((s) => s.visible && (!wanted || wanted.has(s.id)))
      .map((s) => s.id)
      .filter((id) => !query.wormholes || isWormholeSpace(this.deps.universe.space(id)));
    const kills = await this.deps.repo.killsIn(ids, this.deps.clock.now() - query.hours * HOUR, query.limit);
    const book = await this.deps.names.lookup(kills.flatMap(killmailIds), kills.flatMap(tickerIds));
    return { kills: kills.map((k) => killDto(k, book)) };
  }

  /**
   * A system's newest killmails (public game data, for agents and public views; maps read theirs
   * through `mapKills`). Only systems on some map have killmails.
   */
  async recentKills(systemId: number, hours: number, limit: number): Promise<KillmailDto[]> {
    const kills = await this.deps.repo.kills(systemId, this.deps.clock.now() - hours * HOUR, limit);
    const book = await this.deps.names.lookup(kills.flatMap(killmailIds), kills.flatMap(tickerIds));
    return kills.map((k) => killDto(k, book));
  }

  /** Intel of systems a public link shows (public game data; the caller resolved the link). */
  async publicIntel(systemIds: readonly number[]): Promise<MapIntelDto> {
    return { systems: await this.intelFor(systemIds), live: this.deps.live() };
  }

  /** The node's facts of these systems. */
  async intelFor(systemIds: readonly number[]): Promise<SystemIntelDto[]> {
    if (systemIds.length === 0) return [];
    const { repo, clock, universe } = this.deps;
    const now = clock.now();
    const hours = lastHours(now - HOUR, 3);
    const [claims, rows, answered, counts, last, coverage] = await Promise.all([
      repo.claims(systemIds),
      repo.activity(systemIds, hours[0]!),
      repo.answeredHours(hours[0]!),
      repo.killCounts(systemIds, now - HOUR),
      repo.lastKills(systemIds),
      repo.coverage(systemIds),
    ]);
    const shown = new Map<number, SovereigntyClaim>();
    const unheld = new Map<number, RegionHolder & { region: string }>();
    for (const id of systemIds) {
      const space = universe.space(id);
      const claim = shownClaim(claims.get(id) ?? null, space);
      if (claim) shown.set(id, claim);
      else if (space && isNullSec(space) && space.whClass !== 25 && !claims.has(id)) {
        const holder = (await this.regionHolders()).get(space.region);
        if (holder) unheld.set(id, { ...holder, region: space.region });
      }
    }
    const holders = [
      ...[...shown.values()].flatMap((c) =>
        c.kind === 'alliance' ? [c.allianceId, ...(c.corporationId ? [c.corporationId] : [])] : [c.factionId],
      ),
      ...[...unheld.values()].map((h) => h.allianceId),
    ];
    // Tickers: the holding alliances and the corporations that claimed for them.
    const alliances = [
      ...[...shown.values()].flatMap((c) =>
        c.kind === 'alliance' ? [c.allianceId, ...(c.corporationId ? [c.corporationId] : [])] : [],
      ),
      ...[...unheld.values()].map((h) => h.allianceId),
    ];
    const book = holders.length > 0 ? await this.deps.names.lookup(holders, alliances) : new Map();
    const live = this.deps.live();
    return systemIds.map((id) => {
      const latest = isWormholeSpace(universe.space(id))
        ? null
        : latestHour(activitySeries(id, rows, answered, hours), now);
      const cover = coverage.get(id);
      const zkill = counts.get(id)?.count ?? 0;
      return {
        solarSystemId: id,
        sovereignty: sovereigntyDto(shown.get(id) ?? null, book),
        regionHolder: unheld.has(id)
          ? {
              region: unheld.get(id)!.region,
              holder: entityOf(unheld.get(id)!.allianceId, book)!,
              held: unheld.get(id)!.held,
              total: unheld.get(id)!.total,
            }
          : null,
        kills1h: killsLastHour({
          zkill,
          esi: latest,
          complete: live && cover !== undefined && cover.since <= now - HOUR,
        }),
        npcKills1h: latest?.npcKills ?? null,
        jumps1h: latest?.jumps ?? null,
        lastKillAt: last.get(id) ?? null,
      };
    });
  }

  /** A killmail for the kill list and pushes, with the names known (ESI asked for missing ones). */
  async killmail(kill: Killmail): Promise<KillmailDto> {
    const book = await this.deps.names.lookup(killmailIds(kill), tickerIds(kill));
    return killDto(kill, book);
  }
}

/** Corporations and alliances of a killmail whose tickers the kill list shows. */
function tickerIds(kill: Killmail): number[] {
  const top = kill.attackers[0];
  return [kill.victim.corporationId, kill.victim.allianceId, top?.corporationId, top?.allianceId].filter(
    (id): id is number => typeof id === 'number',
  );
}

function sovereigntyDto(claim: SovereigntyClaim | null, book: NameBook): SovereigntyDto | null {
  if (!claim) return null;
  if (claim.kind === 'faction')
    return { kind: 'faction', holder: entityOf(claim.factionId, book)!, corporation: null };
  return {
    kind: 'alliance',
    holder: entityOf(claim.allianceId, book)!,
    corporation: entityOf(claim.corporationId, book),
  };
}

function party(p: KillParty, book: NameBook): KillParticipantDto {
  return {
    character: entityOf(p.characterId, book),
    corporation: entityOf(p.corporationId ?? p.factionId, book),
    alliance: entityOf(p.allianceId, book),
    ship: entityOf(p.shipTypeId, book),
  };
}

export function killDto(kill: Killmail, book: NameBook): KillmailDto {
  return {
    id: kill.id,
    solarSystemId: kill.systemId,
    time: kill.time,
    value: kill.value,
    npc: kill.npc,
    solo: kill.solo,
    victim: party(kill.victim, book),
    finalBlow: kill.finalBlow ? party(kill.finalBlow, book) : null,
    attackerCount: kill.attackerCount,
    attackers: kill.attackers.slice(0, 5).map((g) => ({
      corporation: entityOf(g.corporationId, book),
      alliance: entityOf(g.allianceId, book),
      pilots: g.pilots,
    })),
  };
}
