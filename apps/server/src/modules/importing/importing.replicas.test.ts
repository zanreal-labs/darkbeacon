import { describe, expect, it, vi } from 'vitest';
import { LocalSignals, type Leadership } from '@darkbeacon/core';
import type { ImportRunner } from '@darkbeacon/importing';
import { ImportingRuntime } from './importing.module.js';

function setup(initial: boolean, signals = new LocalSignals()) {
  let leader = initial;
  const listeners = new Set<(leader: boolean) => void>();
  const leadership: Leadership = {
    isLeader: () => leader,
    onChange: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
  };
  const set = (value: boolean) => {
    leader = value;
    for (const listener of listeners) listener(value);
  };
  const runner = { drain: vi.fn(async () => {}) };
  const runtime = new ImportingRuntime(
    {} as never,
    runner as unknown as ImportRunner,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { detached: (work: () => void) => work() } as never,
    { env: 'test' } as never,
    { active: false, register: () => {} } as never,
    leadership,
    signals,
  );
  runtime.onApplicationBootstrap();
  return { runtime, runner, set };
}

describe('imports with replicas', () => {
  it('runs jobs on the leader, which hears of jobs queued on another replica', () => {
    // Two replicas of one instance; signals reach both.
    const signals = new LocalSignals();
    const leader = setup(true, signals);
    const follower = setup(false, signals);
    // The leader looks for jobs at its start, and again when the follower starts.
    expect(leader.runner.drain).toHaveBeenCalledTimes(2);
    expect(follower.runner.drain).not.toHaveBeenCalled();

    follower.runtime.wake();
    expect(follower.runner.drain).not.toHaveBeenCalled();
    expect(leader.runner.drain).toHaveBeenCalledTimes(3);
    leader.runtime.onModuleDestroy();
    follower.runtime.onModuleDestroy();
  });

  it('resumes what was left running when this replica starts leading', () => {
    const replica = setup(false);
    replica.set(true);
    expect(replica.runner.drain).toHaveBeenCalledTimes(1);
    replica.runtime.onModuleDestroy();
  });
});
