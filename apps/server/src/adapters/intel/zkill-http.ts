import type { Clock } from '@darkbeacon/core';
import {
  groupAttackers,
  type IntelMetrics,
  type KillFeed,
  type KillHistory,
  type KillParty,
  type Killmail,
  type SourceResult,
} from '@darkbeacon/intel';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const id = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);

function partyOf(raw: unknown): KillParty {
  const r = isRecord(raw) ? raw : {};
  return {
    characterId: id(r.character_id),
    corporationId: id(r.corporation_id),
    allianceId: id(r.alliance_id),
    factionId: id(r.faction_id),
    shipTypeId: id(r.ship_type_id),
  };
}

/**
 * A killmail as zKillboard hands it out: R2Z2 packages (`{killmail_id, hash, esi: {...}, zkb: {...}}`)
 * and its API's entries (the ESI killmail's fields with `zkb` next to them). Null when it is not
 * a killmail this code understands.
 */
export function parseKillPackage(raw: unknown): Killmail | null {
  if (!isRecord(raw)) return null;
  const esi = isRecord(raw.esi) ? raw.esi : raw;
  const zkb = isRecord(raw.zkb) ? raw.zkb : {};
  const killId = id(raw.killmail_id) ?? id(esi.killmail_id);
  const hash = typeof zkb.hash === 'string' ? zkb.hash : typeof raw.hash === 'string' ? raw.hash : null;
  const systemId = id(esi.solar_system_id);
  const time = typeof esi.killmail_time === 'string' ? Date.parse(esi.killmail_time) : Number.NaN;
  if (killId === null || hash === null || systemId === null || Number.isNaN(time) || !isRecord(esi.victim)) {
    return null;
  }
  const attackers = Array.isArray(esi.attackers) ? esi.attackers.filter(isRecord) : [];
  const finalBlow = attackers.find((a) => a.final_blow === true);
  const value = typeof zkb.totalValue === 'number' && Number.isFinite(zkb.totalValue) ? zkb.totalValue : null;
  return {
    id: killId,
    hash,
    systemId,
    time,
    value,
    npc: zkb.npc === true,
    solo: zkb.solo === true,
    victim: partyOf(esi.victim),
    finalBlow: finalBlow ? partyOf(finalBlow) : null,
    attackerCount:
      typeof zkb.attackerCount === 'number' && zkb.attackerCount >= 0
        ? Math.floor(zkb.attackerCount)
        : attackers.length,
    attackers: groupAttackers(attackers.map(partyOf)),
  };
}

export interface ZkillOptions {
  clock: Clock;
  /** Descriptive, with a way to reach the operator: zKillboard blocks blank and generic ones. */
  userAgent: string;
  fetch?: typeof fetch;
  metrics?: IntelMetrics | null;
}

function outcome(status: number | null): string {
  if (status === null) return 'error';
  if (status === 404 || status === 403 || status === 429) return String(status);
  return `${Math.min(Math.max(Math.floor(status / 100), 1), 5)}xx`;
}

/**
 * zKillboard's killmail API for a system's recent past:
 * `GET https://zkillboard.com/api/kills/solarSystemID/{id}/pastSeconds/{s}/` (trailing slash
 * required, `pastSeconds` up to 604 800 in steps of 3600, 200 killmails per page, killmails under
 * five minutes old held back; https://github.com/zKillboard/zKillboard/wiki/API-(Killmails)). One
 * request at a time (the jobs space them out); 429 waits `Retry-After` (or a minute, doubling), a
 * 403 an hour (a ban), errors back off from 30 s doubling to 30 minutes.
 */
export class ZkillHistory implements KillHistory {
  private failures = 0;
  private pausedUntil = 0;

  constructor(private readonly options: ZkillOptions & { baseUrl?: string }) {}

  async recent(
    systemId: number,
    pastSeconds: number,
  ): Promise<SourceResult<{ kills: Killmail[]; capped: boolean }>> {
    const now = this.options.clock.now();
    if (now < this.pausedUntil) return { ok: false, retryAt: this.pausedUntil, reason: 'paused' };
    const seconds = Math.min(604_800, Math.max(3600, Math.ceil(pastSeconds / 3600) * 3600));
    const base = (this.options.baseUrl ?? 'https://zkillboard.com').replace(/\/+$/, '');
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(
        `${base}/api/kills/solarSystemID/${systemId}/pastSeconds/${seconds}/`,
        {
          headers: {
            accept: 'application/json',
            'accept-encoding': 'gzip',
            'user-agent': this.options.userAgent,
          },
          signal: AbortSignal.timeout(30 * SECOND),
        },
      );
    } catch (error) {
      this.options.metrics?.zkillRequest('api', 'error');
      return this.backoff(now, `request failed: ${String(error)}`);
    }
    this.options.metrics?.zkillRequest('api', outcome(response.status));
    if (response.status === 429) {
      await response.body?.cancel();
      const retryAfter = Number(response.headers.get('retry-after'));
      this.failures += 1;
      this.pausedUntil =
        now +
        (Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * SECOND
          : MINUTE * 2 ** (this.failures - 1));
      return { ok: false, retryAt: this.pausedUntil, reason: 'rate limited (429)' };
    }
    if (response.status === 403) {
      await response.body?.cancel();
      this.pausedUntil = now + HOUR;
      return { ok: false, retryAt: this.pausedUntil, reason: 'refused (403)' };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return this.backoff(now, `HTTP ${response.status}`);
    }
    const body = (await response.json().catch(() => null)) as unknown;
    // Some errors come back as `{"error": "..."}` with a 200.
    if (!Array.isArray(body))
      return this.backoff(now, isRecord(body) ? String(body.error) : 'unexpected answer');
    this.failures = 0;
    const kills = body
      .flatMap((entry) => parseKillPackage(entry) ?? [])
      .filter((k) => k.systemId === systemId);
    return { ok: true, data: { kills, capped: body.length >= 200 }, nextAt: now };
  }

  private backoff(now: number, reason: string) {
    this.failures += 1;
    this.pausedUntil = now + Math.min(30 * SECOND * 2 ** (this.failures - 1), 30 * MINUTE);
    return { ok: false as const, retryAt: this.pausedUntil, reason };
  }
}

/** Well under R2Z2's 15 requests a second. */
const BUSY_MS = 150;
/** R2Z2 asks for at least 6 seconds after a 404 (nothing new yet). */
const IDLE_MS = 6_000;
/** A position older than this may point at files that are gone (kept at least 24 h): start anew. */
const STALE_MS = 6 * HOUR;

export interface R2z2Options extends ZkillOptions {
  baseUrl?: string;
  /** Where the feed stopped, kept across restarts. */
  load(): Promise<{ sequence: number; at: number } | null>;
  save(position: { sequence: number; at: number }): Promise<void>;
  sleep?(ms: number): Promise<void>;
}

/**
 * zKillboard's live feed, R2Z2 (https://zkillboard.com/api/docs/; RedisQ was sunset on
 * 2026-05-31): `ephemeral/sequence.json` gives a recent sequence number, `ephemeral/<n>.json` one
 * killmail package, 404 until it exists. Read one by one, 150 ms apart, 6 s after a 404; a 429 or
 * 403 waits a minute or an hour. The position is saved after every package.
 */
export class R2z2KillFeed implements KillFeed {
  private running = false;
  private stopped: Promise<void> | null = null;
  private wake: (() => void) | null = null;

  constructor(private readonly options: R2z2Options) {}

  start(handlers: Parameters<KillFeed['start']>[0]): void {
    if (this.running) return;
    this.running = true;
    this.stopped = this.loop(handlers);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.stopped;
  }

  private sleep(ms: number): Promise<void> {
    if (this.options.sleep) return this.options.sleep(ms);
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  private get base(): string {
    return (this.options.baseUrl ?? 'https://r2z2.zkillboard.com').replace(/\/+$/, '');
  }

  private async loop(handlers: Parameters<KillFeed['start']>[0]): Promise<void> {
    let sequence: number | null = null;
    let failures = 0;
    while (this.running) {
      try {
        if (!(await handlers.wanted())) {
          sequence = null;
          await this.sleep(IDLE_MS * 5);
          continue;
        }
        sequence ??= await this.startingPoint(handlers);
        if (sequence === null) {
          await this.sleep(IDLE_MS);
          continue;
        }
        const response = await this.get(`${this.base}/ephemeral/${sequence}.json`);
        if (response.status === 404) {
          await response.body?.cancel();
          handlers.onAlive();
          await this.sleep(IDLE_MS);
          continue;
        }
        if (response.status === 429 || response.status === 403) {
          await response.body?.cancel();
          await this.sleep(response.status === 403 ? HOUR : MINUTE);
          continue;
        }
        if (!response.ok) throw new Error(`R2Z2 answered ${response.status}`);
        handlers.onAlive();
        failures = 0;
        const kill = parseKillPackage(await response.json());
        if (kill) await handlers.onKill(kill);
        sequence += 1;
        await this.options.save({ sequence, at: this.options.clock.now() });
        await this.sleep(BUSY_MS);
      } catch (error) {
        handlers.onError(error);
        failures += 1;
        await this.sleep(Math.min(IDLE_MS * 2 ** failures, 5 * MINUTE));
      }
    }
  }

  private async startingPoint(handlers: Parameters<KillFeed['start']>[0]): Promise<number | null> {
    const saved = await this.options.load();
    if (saved && this.options.clock.now() - saved.at < STALE_MS) return saved.sequence;
    const response = await this.get(`${this.base}/ephemeral/sequence.json`);
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    handlers.onAlive();
    const body = (await response.json()) as { sequence?: unknown };
    return typeof body.sequence === 'number' ? body.sequence : null;
  }

  private async get(url: string): Promise<Response> {
    try {
      const response = await (this.options.fetch ?? fetch)(url, {
        headers: { accept: 'application/json', 'user-agent': this.options.userAgent },
        signal: AbortSignal.timeout(15 * SECOND),
      });
      this.options.metrics?.zkillRequest('r2z2', outcome(response.status));
      return response;
    } catch (error) {
      this.options.metrics?.zkillRequest('r2z2', 'error');
      throw error;
    }
  }
}
