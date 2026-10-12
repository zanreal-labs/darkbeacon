import type { RateLimiter } from '@darkbeacon/tracking';

interface Bucket {
  tokens: number;
  at: number;
}

/** Most buckets kept; the oldest go first when an attack fills the table. */
const MAX_BUCKETS = 50_000;

/**
 * Token buckets by key, in memory: `take(key, perMinute)` refills continuously at `perMinute` and
 * allows bursts up to `burst` (a minute's worth unless told otherwise). The one rate limiting
 * mechanism of the server: requests per client address and per API key at the edge, and the
 * tracking poller's ESI budget (`BucketBudget`). Each process keeps its own; a restart only
 * forgets who was close to a limit.
 */
export class TokenBuckets {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /**
   * Takes `cost` tokens; when there are not enough, takes nothing and says how many seconds until
   * there are.
   */
  take(
    key: string,
    perMinute: number,
    cost = 1,
    burst = perMinute,
  ): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const now = this.now();
    const rate = perMinute / 60_000;
    const current = this.buckets.get(key);
    const tokens = current ? Math.min(burst, current.tokens + (now - current.at) * rate) : burst;
    if (tokens < cost) {
      this.set(key, { tokens, at: now });
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((cost - tokens) / rate / 1000)) };
    }
    this.set(key, { tokens: tokens - cost, at: now });
    return { ok: true };
  }

  /** True while `key` has no token left (without taking one). */
  exhausted(key: string, perMinute: number): boolean {
    const current = this.buckets.get(key);
    if (!current) return false;
    return current.tokens + (this.now() - current.at) * (perMinute / 60_000) < 1;
  }

  private set(key: string, bucket: Bucket): void {
    this.buckets.delete(key);
    this.buckets.set(key, bucket);
    if (this.buckets.size > MAX_BUCKETS) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
  }
}

/**
 * One bucket as the tracking poller's budget (`RateLimiter` port): `perSecond` ESI requests over
 * every character, bursts up to `burst` (one second's worth by default). The poller runs on one
 * process (the leader), so the budget is that process's.
 */
export class BucketBudget implements RateLimiter {
  constructor(
    private readonly buckets: TokenBuckets,
    private readonly key: string,
    private readonly perSecond: number,
    private readonly burst: number = perSecond,
  ) {}

  tryTake(cost: number): boolean {
    return this.buckets.take(this.key, this.perSecond * 60, cost, this.burst).ok;
  }
}
