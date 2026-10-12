import { describe, expect, it, vi } from 'vitest';
import { newEvent, type DomainEvent, type EventBus, type Leadership } from '@darkbeacon/core';
import type { ChainMerger } from '@darkbeacon/sharing';
import { SharingModule } from './sharing.module.js';

function switchable(initial: boolean) {
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
  return { leadership, set };
}

function setup(leader: boolean) {
  const { leadership, set } = switchable(leader);
  const merger = {
    forget: vi.fn(),
    reset: vi.fn(),
    rebuildAll: vi.fn(async () => {}),
    sourceChanged: vi.fn(async () => {}),
  };
  let handler: ((event: DomainEvent) => void) | undefined;
  const bus = {
    subscribe: (h: (event: DomainEvent) => void) => ((handler = h), () => {}),
  } as unknown as EventBus;
  const module = new SharingModule(
    merger as unknown as ChainMerger,
    {} as never,
    { use: () => {} } as never,
    { registerSnapshot: () => {} } as never,
    bus,
    { register: () => {} } as never,
    {} as never,
    leadership,
  );
  module.onModuleInit();
  const moved = newEvent({
    stream: 'map:m1',
    type: 'system.updated',
    actor: { kind: 'system', id: 'test' },
    data: { solarSystemId: 31000001, position: { x: 1, y: 1 } },
    occurredAt: 0,
  }) as unknown as DomainEvent;
  return { module, merger, set, emit: () => handler!(moved) };
}

describe('sharing with replicas', () => {
  it('merges on the leader only; a follower forgets what it kept of the map', async () => {
    const follower = setup(false);
    await follower.module.onApplicationBootstrap();
    expect(follower.merger.rebuildAll).not.toHaveBeenCalled();
    follower.emit();
    expect(follower.merger.forget).toHaveBeenCalledWith('m1');
    expect(follower.merger.sourceChanged).not.toHaveBeenCalled();

    const leader = setup(true);
    await leader.module.onApplicationBootstrap();
    expect(leader.merger.rebuildAll).toHaveBeenCalledTimes(1);
    leader.emit();
    await vi.waitFor(() => expect(leader.merger.sourceChanged).toHaveBeenCalled());
    expect(leader.merger.forget).not.toHaveBeenCalled();
    leader.module.onModuleDestroy();
    follower.module.onModuleDestroy();
  });

  it('merges everything again from scratch when this replica starts leading', async () => {
    const replica = setup(false);
    await replica.module.onApplicationBootstrap();
    replica.set(true);
    expect(replica.merger.reset).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(replica.merger.rebuildAll).toHaveBeenCalledTimes(1));
    replica.module.onModuleDestroy();
  });
});
