import { describe, expect, it } from 'vitest';
import type { ConnectionDto, MapSystemDto } from '@darkbeacon/shared';
import { chainPresenceChanges, replayChainPresence, type ReplayedEvent } from './chain-presence.js';

const MAP = 'm1';
const row = (solarSystemId: number, joinedAt: number, leftAt: number | null = null) => ({
  mapId: MAP,
  solarSystemId,
  joinedAt,
  leftAt,
});

describe('recording the chain', () => {
  it('stamps systems that join and leave, and nothing else', () => {
    const current = [row(1, 10), row(2, 10), row(3, 10, 20)];
    // 2 left, 3 came back, 4 is new; 1 stays.
    expect(chainPresenceChanges(MAP, current, new Set([1, 3, 4]), 30)).toEqual(
      expect.arrayContaining([row(3, 30), row(4, 30), row(2, 10, 30)]),
    );
    expect(chainPresenceChanges(MAP, current, new Set([1, 3, 4]), 30)).toHaveLength(3);
    // A chain that did not change writes nothing; systems out stay as they left.
    expect(chainPresenceChanges(MAP, current, new Set([1, 2]), 40)).toEqual([]);
  });
});

describe('playing a map’s history back', () => {
  const actor = { kind: 'account', id: 'alice' };
  const sys = (solarSystemId: number, status: MapSystemDto['status'] = 'unknown') =>
    ({ solarSystemId, status, visible: true, createdAt: 0 }) as MapSystemDto;
  const con = (id: string, source: number, target: number) => ({ id, source, target }) as ConnectionDto;
  const at = (occurredAt: number, type: string, data: unknown, by = actor): ReplayedEvent => ({
    type,
    occurredAt,
    actor: by,
    data,
  });

  it('records when each system joined and left the chain from home', () => {
    const rows = replayChainPresence(MAP, [
      at(1, 'system.added', sys(100, 'home')),
      at(2, 'system.added', sys(200)),
      at(3, 'connection.added', con('a', 100, 200)),
      at(4, 'system.added', sys(300)),
      at(5, 'connection.added', con('b', 200, 300)),
      // Layout and notes do not move the chain.
      at(6, 'system.updated', { ...sys(300), description: 'gas' }),
      at(7, 'connection.removed', { id: 'b' }),
      at(8, 'system.removed', { solarSystemId: 300 }),
      at(9, 'connection.removed', { id: 'a' }),
      at(10, 'system.added', sys(300)),
      at(11, 'connection.added', con('c', 100, 300)),
    ]);
    expect(rows.sort((a, b) => a.solarSystemId - b.solarSystemId)).toEqual([
      row(100, 1),
      row(200, 3, 9),
      row(300, 11),
    ]);
  });

  it('turns the chain when the home moves and skips what a merge wrote', () => {
    const merge = { kind: 'system', id: 'sharing-copy' };
    const rows = replayChainPresence(MAP, [
      at(1, 'system.added', sys(100, 'home')),
      at(2, 'system.added', sys(200)),
      at(3, 'system.added', sys(300)),
      at(4, 'connection.added', con('a', 200, 300)),
      at(5, 'connection.added', con('m', 100, 200), merge),
      at(6, 'system.updated', sys(100)),
      at(7, 'system.updated', sys(200, 'home')),
    ]);
    // Without a home in between, the oldest system (100) is the chain on its own.
    expect(rows.sort((a, b) => a.solarSystemId - b.solarSystemId)).toEqual([
      row(100, 1, 7),
      row(200, 7),
      row(300, 7),
    ]);
  });
});
