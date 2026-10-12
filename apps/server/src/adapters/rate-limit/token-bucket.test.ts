import { ManualClock } from '@darkbeacon/core';
import { describe, expect, it } from 'vitest';
import { TokenBucket } from './token-bucket.js';

describe('TokenBucket', () => {
  it('allows a burst, then what comes back each second', () => {
    const clock = new ManualClock(0);
    const bucket = new TokenBucket(clock, 10);
    expect(bucket.tryTake(8)).toBe(true);
    expect(bucket.tryTake(3)).toBe(false); // nothing is taken when there is not enough
    expect(bucket.tryTake(2)).toBe(true);
    clock.advance(500);
    expect(bucket.tryTake(5)).toBe(true);
    expect(bucket.tryTake(1)).toBe(false);
    clock.advance(60_000);
    expect(bucket.tryTake(10)).toBe(true);
    expect(bucket.tryTake(1)).toBe(false);
  });
});
