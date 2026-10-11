/** Time source port. Always inject it; never call Date.now() in domain or application code. */
export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/** Manually driven clock for tests. */
export class ManualClock implements Clock {
  constructor(private time = Date.UTC(2026, 0, 1)) {}

  now(): number {
    return this.time;
  }

  set(time: number): void {
    this.time = time;
  }

  advance(ms: number): void {
    this.time += ms;
  }
}
