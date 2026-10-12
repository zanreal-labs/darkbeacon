import type { Clock } from '@darkbeacon/core';
import type { RateLimiter } from '@darkbeacon/tracking';

/**
 * In-memory token bucket: `perSecond` tokens come back every second, up to `burst`. One process
 * holds the budget; it is the tracking poller's, which runs on one process (the leader).
 */
export class TokenBucket implements RateLimiter {
  private tokens: number;
  private updatedAt: number;

  constructor(
    private readonly clock: Clock,
    private readonly perSecond: number,
    private readonly burst: number = perSecond,
  ) {
    this.tokens = burst;
    this.updatedAt = clock.now();
  }

  tryTake(cost: number): boolean {
    const now = this.clock.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.updatedAt) / 1000) * this.perSecond);
    this.updatedAt = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
