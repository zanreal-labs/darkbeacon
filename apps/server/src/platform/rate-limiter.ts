import { TokenBuckets } from '../adapters/rate-limit/token-buckets.js';

/**
 * The edge's limits (client addresses, API keys, public reads) as keyed token buckets: the same
 * mechanism as the tracking poller's ESI budget. Each replica counts its own requests, so behind
 * a load balancer spreading one client over N replicas the limit is N times as high.
 */
export class RateLimiter extends TokenBuckets {}

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
