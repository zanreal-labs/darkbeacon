import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Leadership } from '@darkbeacon/core';
import { IdentityModule } from './identity.module.js';

afterEach(() => vi.useRealTimers());

function setup(leader: boolean) {
  const affiliations = { run: vi.fn(async () => {}) };
  const sessions = { pruneExpired: vi.fn(async () => {}) };
  const leadership: Leadership = { isLeader: () => leader, onChange: () => () => {} };
  const module = new IdentityModule(
    {} as never,
    sessions as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { active: false } as never,
    leadership,
    affiliations as never,
    { env: 'production' } as never,
  );
  return { module, affiliations, sessions };
}

describe('identity with replicas', () => {
  it('refreshes affiliations and prunes sessions on the leader only', () => {
    vi.useFakeTimers();
    const leader = setup(true);
    const follower = setup(false);
    leader.module.onApplicationBootstrap();
    follower.module.onApplicationBootstrap();
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(leader.affiliations.run).toHaveBeenCalledTimes(6);
    expect(leader.sessions.pruneExpired).toHaveBeenCalledTimes(1);
    expect(follower.affiliations.run).not.toHaveBeenCalled();
    expect(follower.sessions.pruneExpired).not.toHaveBeenCalled();
    leader.module.onModuleDestroy();
    follower.module.onModuleDestroy();
  });
});
