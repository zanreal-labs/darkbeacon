import { NotFoundError, requireAccount, requireMapRole, type Actor } from '@darkbeacon/core';
import type {
  ActivityPeriod,
  CharacterActivityDto,
  EveServerStatusDto,
  MapTrackingSettingsDto,
  UpdateMapTrackingSettingsRequest,
} from '@darkbeacon/shared';
import type {
  ActivityReader,
  CharacterTokenSource,
  Clock,
  MapAccess,
  MapCharacterSettingsRepository,
  ServerStatusReading,
  ServerStatusSource,
  TrackingRepository,
} from '../ports/index.js';

/**
 * My own character settings on a map (Wanderer's per-map main and "following"): which of my
 * characters is my main there and which one the map follows. Only my own characters count.
 */
export class MapCharacterSettingsUseCases {
  constructor(
    private readonly deps: {
      settings: MapCharacterSettingsRepository;
      characters: CharacterTokenSource;
      access: MapAccess;
      clock: Clock;
    },
  ) {}

  async get(actor: Actor | null, mapId: string): Promise<MapTrackingSettingsDto> {
    const account = requireAccount(actor);
    await requireMapRole(this.deps.access, actor, mapId, 'viewer');
    const stored = await this.deps.settings.get(mapId, account.id);
    return {
      mainCharacterId: await this.own(account.id, stored?.mainCharacterId ?? null),
      followCharacterId: await this.own(account.id, stored?.followCharacterId ?? null),
    };
  }

  async update(
    actor: Actor | null,
    mapId: string,
    patch: UpdateMapTrackingSettingsRequest,
  ): Promise<MapTrackingSettingsDto> {
    const account = requireAccount(actor);
    await requireMapRole(this.deps.access, actor, mapId, 'viewer');
    for (const id of [patch.mainCharacterId, patch.followCharacterId]) {
      if (id != null && (await this.own(account.id, id)) === null) throw new NotFoundError('Character');
    }
    const current = await this.get(actor, mapId);
    const next = { ...current, ...patch };
    await this.deps.settings.save({
      mapId,
      accountId: account.id,
      mainCharacterId: next.mainCharacterId ?? null,
      followCharacterId: next.followCharacterId ?? null,
      updatedAt: this.deps.clock.now(),
    });
    return {
      mainCharacterId: next.mainCharacterId ?? null,
      followCharacterId: next.followCharacterId ?? null,
    };
  }

  /** The id when the character is still mine, else null (unlinked or sold since). */
  private async own(accountId: string, characterId: number | null): Promise<number | null> {
    if (characterId === null) return null;
    const owner = await this.deps.characters.character(characterId);
    return owner?.accountId === accountId ? characterId : null;
  }
}

const DAY = 24 * 60 * 60 * 1000;
const SINCE: Record<ActivityPeriod, number> = { '30d': 30 * DAY, '1y': 365 * DAY, all: Infinity };

/** Wanderer's character activity: jumps and what each character added on the map, per period. */
export class CharacterActivity {
  constructor(
    private readonly deps: {
      activity: ActivityReader;
      characters: CharacterTokenSource;
      tracking: TrackingRepository;
      access: MapAccess;
      clock: Clock;
    },
  ) {}

  async list(actor: Actor | null, mapId: string, period: ActivityPeriod): Promise<CharacterActivityDto[]> {
    await requireMapRole(this.deps.access, actor, mapId, 'viewer');
    const span = SINCE[period];
    const since = span === Infinity ? 0 : this.deps.clock.now() - span;
    const rows = await this.deps.activity.activity(mapId, since);
    const presence = new Map(
      (await this.deps.tracking.listPresence(rows.map((r) => r.characterId))).map((p) => [p.characterId, p]),
    );
    const named = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        name:
          presence.get(row.characterId)?.name ||
          (await this.deps.characters.character(row.characterId))?.name ||
          null,
      })),
    );
    const total = (r: (typeof named)[number]) => r.jumps + r.systems + r.connections + r.signatures;
    return named.sort((a, b) => total(b) - total(a) || (a.name ?? '').localeCompare(b.name ?? ''));
  }
}

/** How often ESI `/status` is read (it is cached for 30 s). */
export const STATUS_INTERVAL_MS = 60_000;

/**
 * Tranquility as ESI `/status` last said. Tracking waits while TQ is down or open to VIPs only
 * (downtime): ESI's character routes answer errors then, which would only cost error budget.
 * When ESI itself cannot be reached nothing is known and tracking carries on.
 */
export class ServerStatusWatch {
  private last: ServerStatusReading = { kind: 'unknown' };
  private checkedAt: number | null = null;

  constructor(private readonly deps: { source: ServerStatusSource; clock: Clock }) {}

  async refresh(): Promise<void> {
    this.last = await this.deps.source.read().catch((): ServerStatusReading => ({ kind: 'unknown' }));
    this.checkedAt = this.deps.clock.now();
  }

  /** True while polling ESI for characters makes no sense. */
  get paused(): boolean {
    return this.last.kind === 'down' || (this.last.kind === 'up' && this.last.vip);
  }

  get status(): EveServerStatusDto {
    const last = this.last;
    return {
      online: last.kind === 'unknown' ? null : last.kind === 'up' && !last.vip,
      players: last.kind === 'up' ? last.players : null,
      vip: last.kind === 'up' && last.vip,
      serverVersion: last.kind === 'up' ? last.serverVersion : null,
      startedAt: last.kind === 'up' ? last.startedAt : null,
      checkedAt: this.checkedAt,
      trackingPaused: this.paused,
    };
  }
}
