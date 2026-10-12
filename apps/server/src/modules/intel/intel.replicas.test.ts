import { describe, expect, it, vi } from 'vitest';
import { LocalSignals, type EventBus, type Leadership } from '@darkbeacon/core';
import type { IntelJobs } from '@darkbeacon/intel';
import { INTEL_CHANGED } from '../../adapters/intel/server-ports.js';
import { IntelRuntime } from './intel.module.js';

function switchable(initial: boolean) {
  let leader = initial;
  const leadership: Leadership = { isLeader: () => leader, onChange: () => () => {} };
  return { leadership, set: (value: boolean) => (leader = value) };
}

function setup(leader: boolean) {
  const { leadership, set } = switchable(leader);
  const calls: string[] = [];
  const jobs = {
    start: vi.fn(async () => void calls.push('start')),
    stop: vi.fn(async () => void calls.push('stop')),
    tick: vi.fn(async () => void calls.push('tick')),
    observe: vi.fn(async () => void calls.push('observe')),
    changed: vi.fn(async () => {}),
    systemsChanged: vi.fn(async () => {}),
  };
  const signals = new LocalSignals();
  const bus = { subscribe: () => () => {} } as unknown as EventBus;
  const runtime = new IntelRuntime(
    jobs as unknown as IntelJobs,
    bus,
    { sources: new Set(['esi', 'zkill', 'r2z2']), killDays: 7 },
    leadership,
    signals,
  );
  // The runtime's own timer is not waited for; ticks are driven here.
  const tick = () => (runtime as unknown as { tick(): Promise<void> }).tick();
  return { runtime, jobs, calls, signals, set, tick };
}

describe('intel with replicas', () => {
  it('runs the jobs where the leader is, and hands them over when leadership moves', async () => {
    const replica = setup(false);
    await replica.runtime.onModuleInit();
    await replica.tick();
    expect(replica.jobs.start).not.toHaveBeenCalled();
    expect(replica.jobs.tick).not.toHaveBeenCalled();
    expect(replica.jobs.observe).toHaveBeenCalled();

    replica.set(true);
    await replica.tick();
    expect(replica.calls.filter((c) => c !== 'observe')).toEqual(['start', 'tick']);

    replica.set(false);
    await replica.tick();
    expect(replica.calls.at(-2)).toBe('stop');
    expect(replica.calls.at(-1)).toBe('observe');
    await replica.runtime.onModuleDestroy();
  });

  it('pushes the changes every replica is signalled to its own viewers', async () => {
    const replica = setup(false);
    await replica.runtime.onModuleInit();
    replica.signals.publish(INTEL_CHANGED, { systemIds: [30004759], claims: true });
    replica.signals.publish(INTEL_CHANGED, { nonsense: true });
    expect(replica.jobs.changed).toHaveBeenCalledTimes(1);
    expect(replica.jobs.changed).toHaveBeenCalledWith({ systemIds: [30004759], claims: true });
    await replica.runtime.onModuleDestroy();
  });
});
