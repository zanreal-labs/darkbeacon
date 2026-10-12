import { ManualClock } from '@darkbeacon/core';
import { describe, expect, it } from 'vitest';
import { BucketBudget, TokenBuckets } from './token-buckets.js';

describe('TokenBuckets', () => {
  it('allows a minute of requests at once, then what comes back', () => {
    const clock = new ManualClock(0);
    const buckets = new TokenBuckets(() => clock.now());
    for (let i = 0; i < 60; i++) expect(buckets.take('a', 60).ok).toBe(true);
    expect(buckets.take('a', 60)).toEqual({ ok: false, retryAfterSeconds: 1 });
    expect(buckets.exhausted('a', 60)).toBe(true);
    // Keys are separate.
    expect(buckets.take('b', 60).ok).toBe(true);
    clock.advance(1_000);
    expect(buckets.take('a', 60).ok).toBe(true);
    expect(buckets.take('a', 60).ok).toBe(false);
  });

  it('keeps bursts under `burst` when given', () => {
    const clock = new ManualClock(0);
    const buckets = new TokenBuckets(() => clock.now());
    expect(buckets.take('k', 600, 10, 10).ok).toBe(true);
    expect(buckets.take('k', 600, 1, 10)).toEqual({ ok: false, retryAfterSeconds: 1 });
    clock.advance(60_000);
    expect(buckets.take('k', 600, 11, 10).ok).toBe(false);
    expect(buckets.take('k', 600, 10, 10).ok).toBe(true);
  });
});

describe('BucketBudget', () => {
  it('allows a burst, then what comes back each second', () => {
    const clock = new ManualClock(0);
    const bucket = new BucketBudget(new TokenBuckets(() => clock.now()), 'esi', 10);
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
