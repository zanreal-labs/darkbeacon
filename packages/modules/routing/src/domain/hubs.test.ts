import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP_HUBS, MAX_HUBS, TRADE_HUBS, withDefaultHubs } from './hubs.js';

const HOME = 31001269;

describe('default map hubs', () => {
  it('are the five trade hubs', () => {
    expect(TRADE_HUBS.map((h) => h.name)).toEqual(['Jita', 'Amarr', 'Dodixie', 'Rens', 'Hek']);
    expect(DEFAULT_MAP_HUBS).toEqual(TRADE_HUBS.map((h) => h.solarSystemId));
  });

  it('come after the hubs a map has, never twice, up to the limit', () => {
    expect(withDefaultHubs([])).toEqual(DEFAULT_MAP_HUBS);
    expect(withDefaultHubs([HOME, 30000142])).toEqual([
      HOME,
      30000142,
      30002187,
      30002659,
      30002510,
      30002053,
    ]);
    expect(withDefaultHubs([...DEFAULT_MAP_HUBS].reverse())).toBeNull();
    const many = Array.from({ length: MAX_HUBS - 1 }, (_, i) => 30000001 + i);
    expect(withDefaultHubs(many)).toEqual([...many, 30000142]);
    expect(withDefaultHubs([...many, HOME])).toBeNull();
  });
});
