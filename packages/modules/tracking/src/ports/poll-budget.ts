/**
 * How many ESI requests the poller may start now, over every character: a global budget on top
 * of ESI's own per-character buckets, so one instance never sends more than its operator allows
 * (and an instance with many characters spreads them instead of bursting). Adapters may share
 * the budget between processes; the default is in memory (the poller runs on one process).
 */
export interface RateLimiter {
  /** Takes `cost` requests from the budget; false (and nothing taken) when there is not enough. */
  tryTake(cost: number): boolean;
}

/**
 * Which maps someone is looking at right now (an open map page). Their characters are polled
 * first when the budget is short.
 */
export interface MapViewers {
  isViewed(mapId: string): boolean;
}
