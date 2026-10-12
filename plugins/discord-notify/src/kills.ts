// Kills from zKillboard's R2Z2 feed (https://github.com/zKillboard/zKillboard/wiki/API-(R2Z2)):
// `ephemeral/sequence.json` gives the newest sequence; `ephemeral/<n>.json` is one killmail, 404
// until it exists. R2Z2 allows 15 requests a second per IP and asks to wait at least 6 seconds
// after a 404; a blank user agent is blocked.
import type { Fetch } from './deliver.js';
import type { KillSummary } from './describe.js';

const R2Z2 = 'https://r2z2.zkillboard.com/ephemeral';
const IDLE_MS = 6_000;
/** Well under R2Z2's 15 requests a second. */
const BUSY_MS = 150;
/** A sequence older than this is likely gone (files last at least 24 h); start from the newest. */
const STALE_MS = 6 * 60 * 60 * 1000;

export interface KillFeedOptions {
  fetch: Fetch;
  now(): number;
  /** Where the feed stopped, kept across restarts. */
  load(): Promise<{ sequence: number; at: number } | null>;
  save(position: { sequence: number; at: number }): Promise<void>;
  /** Whether any map wants kills right now; the feed idles otherwise. */
  wanted(): Promise<boolean>;
  onKill(kill: KillSummary & { victimId: number | null; shipTypeId: number | null }): Promise<void>;
  onError(error: unknown): void;
  sleep?(ms: number): Promise<void>;
}

interface KillPackage {
  killmail_id?: number;
  esi?: {
    solar_system_id?: number;
    killmail_time?: string;
    victim?: { character_id?: number; ship_type_id?: number };
    attackers?: unknown[];
  };
  zkb?: { totalValue?: number; npc?: boolean; attackerCount?: number };
}

export class KillFeed {
  private running = false;
  private stopped: Promise<void> | null = null;
  private wake: (() => void) | null = null;

  constructor(private readonly options: KillFeedOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = this.loop();
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
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  private async loop(): Promise<void> {
    let sequence: number | null = null;
    while (this.running) {
      try {
        if (!(await this.options.wanted())) {
          sequence = null;
          await this.sleep(IDLE_MS * 5);
          continue;
        }
        sequence ??= await this.startingPoint();
        if (sequence === null) {
          await this.sleep(IDLE_MS);
          continue;
        }
        const response = await this.get(`${R2Z2}/${sequence}.json`);
        if (response.status === 404) {
          await this.sleep(IDLE_MS);
          continue;
        }
        if (!response.ok) throw new Error(`zKillboard answered ${response.status}`);
        await this.handle((await response.json()) as KillPackage);
        sequence += 1;
        await this.options.save({ sequence, at: this.options.now() });
        await this.sleep(BUSY_MS);
      } catch (error) {
        this.options.onError(error);
        await this.sleep(IDLE_MS * 2);
      }
    }
  }

  private async startingPoint(): Promise<number | null> {
    const saved = await this.options.load();
    if (saved && this.options.now() - saved.at < STALE_MS) return saved.sequence;
    const response = await this.get(`${R2Z2}/sequence.json`);
    if (!response.ok) return null;
    const body = (await response.json()) as { sequence?: number };
    return typeof body.sequence === 'number' ? body.sequence : null;
  }

  private get(url: string): Promise<Response> {
    return this.options.fetch(url, {
      headers: { 'user-agent': 'Darkbeacon (self-hosted wormhole mapper)', accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
  }

  private async handle(pkg: KillPackage): Promise<void> {
    const systemId = pkg.esi?.solar_system_id;
    if (!pkg.killmail_id || !systemId || pkg.zkb?.npc) return;
    await this.options.onKill({
      killId: pkg.killmail_id,
      systemId,
      victimId: pkg.esi?.victim?.character_id ?? null,
      shipTypeId: pkg.esi?.victim?.ship_type_id ?? null,
      victim: null,
      ship: null,
      value: pkg.zkb?.totalValue ?? null,
      attackers: pkg.zkb?.attackerCount ?? pkg.esi?.attackers?.length ?? null,
      time: pkg.esi?.killmail_time ? Date.parse(pkg.esi.killmail_time) : this.options.now(),
    });
  }
}
