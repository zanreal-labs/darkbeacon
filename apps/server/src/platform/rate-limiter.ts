import { Injectable } from '@nestjs/common';

interface Bucket {
  tokens: number;
  at: number;
}

/** Most buckets kept; the oldest go first when an attack fills the table. */
const MAX_BUCKETS = 50_000;

/**
 * In-process token buckets: `take(key, perMinute)` allows bursts up to `perMinute` and refills
 * continuously. One process serves the instance, so memory is the right place; a restart only
 * forgets who was close to a limit.
 */
@Injectable()
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Takes one token; when none is left, says how many seconds until one is. */
  take(key: string, perMinute: number, cost = 1): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const now = this.now();
    const rate = perMinute / 60_000;
    const current = this.buckets.get(key);
    const tokens = current ? Math.min(perMinute, current.tokens + (now - current.at) * rate) : perMinute;
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

/** Limits, per minute. */
export const LIMITS = {
  /** Requests from one client address, signed in or not (loopback is not counted). */
  perAddress: 600,
  /** Requests of one API key without its own limit. */
  keyDefault: 300,
  /** Failed bearer tokens from one address before it is refused for a while (brute force). */
  authFailures: 10,
  /** Anonymous public map and MCP reads from one address. */
  publicReads: 120,
  /** WebSocket subscriptions to public streams from one address. */
  publicSubscribes: 30,
} as const;
