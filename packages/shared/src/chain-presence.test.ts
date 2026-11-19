import { describe, expect, it } from 'vitest';
import { chainFromHome, type MapSystemDto } from './index.js';

type System = Pick<MapSystemDto, 'solarSystemId' | 'status' | 'visible' | 'createdAt'>;

const system = (solarSystemId: number, extra: Partial<System> = {}): System => ({
  solarSystemId,
  status: 'unknown',
  visible: true,
  createdAt: solarSystemId,
  ...extra,
});
const link = (source: number, target: number) => ({ source, target });
const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);

describe('the chain from home', () => {
  it('is every system reachable from a home, whichever way the connections were drawn', () => {
    const systems = [system(1), system(2, { status: 'home' }), system(3), system(4), system(5)];
    // 1 - 2 (home) <- 3, and 4 - 5 hanging apart.
    expect(sorted(chainFromHome(systems, [link(1, 2), link(3, 2), link(4, 5)]))).toEqual([1, 2, 3]);
  });

  it('grows from every home', () => {
    const systems = [system(1, { status: 'home' }), system(2), system(3, { status: 'home' }), system(4)];
    expect(sorted(chainFromHome(systems, [link(1, 2), link(3, 4)]))).toEqual([1, 2, 3, 4]);
  });

  it('grows from the oldest system on a map without a home', () => {
    const systems = [system(7, { createdAt: 5 }), system(8, { createdAt: 1 }), system(9, { createdAt: 3 })];
    expect(sorted(chainFromHome(systems, [link(8, 9)]))).toEqual([8, 9]);
    expect(chainFromHome([], [])).toEqual(new Set());
  });

  it('leaves hidden systems out and does not walk through them', () => {
    const systems = [system(1, { status: 'home' }), system(2, { visible: false }), system(3)];
    expect(sorted(chainFromHome(systems, [link(1, 2), link(2, 3)]))).toEqual([1]);
    // A hidden home is no home: the oldest shown system is the root then.
    const hiddenHome = [system(1, { status: 'home', visible: false }), system(2), system(3)];
    expect(sorted(chainFromHome(hiddenHome, [link(2, 3)]))).toEqual([2, 3]);
  });
});
