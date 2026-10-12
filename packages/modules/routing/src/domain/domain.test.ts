import { describe, expect, it } from 'vitest';
import { findRoute, jumpsTo, RouteGraph, StargateGraph } from './graph.js';
import { isLowSec, nearestStaging } from './hubs.js';
import { isHighSecSpace, isWormholeSpace, policyFor, type RouteNode } from './modes.js';
import { closedLevels, displaySecurity, isHighSec, policeAttack } from './security.js';

describe('security', () => {
  it('rounds like the game: one decimal, (0, 0.05) shown as 0.1', () => {
    expect(displaySecurity(0.9459)).toBe(0.9);
    expect(displaySecurity(0.45)).toBe(0.5);
    expect(displaySecurity(0.4499)).toBe(0.4);
    expect(displaySecurity(0.04)).toBe(0.1);
    expect(displaySecurity(0)).toBe(0);
    expect(displaySecurity(-0.99)).toBe(-1);
  });

  it('counts 0.45 and up as high-sec', () => {
    expect(isHighSec(0.45)).toBe(true);
    expect(isHighSec(0.4499)).toBe(false);
  });

  it('knows where faction police attack a pilot', () => {
    expect(policeAttack(1.0, -2.0)).toBe(true);
    expect(policeAttack(1.0, -1.99)).toBe(false);
    expect(policeAttack(0.9459, -2.5)).toBe(true); // shown 0.9
    expect(policeAttack(0.9459, -2.4)).toBe(false);
    expect(policeAttack(0.5, -4.5)).toBe(true);
    expect(policeAttack(0.5, -4.4)).toBe(false);
    expect(policeAttack(0.4, -10)).toBe(false); // low-sec has no police
    expect(closedLevels(0)).toBe(0);
    expect(closedLevels(-2)).toBe(1);
    expect(closedLevels(-3.2)).toBe(3);
    expect(closedLevels(-10)).toBe(6);
  });
});

const node = (id: number, security: number, whClass: number | null = null): RouteNode => ({
  id,
  security,
  whClass: whClass ?? (security >= 0.45 ? 7 : security > 0 ? 8 : 9),
});

/**
 *   1 (1.0) - 2 (0.5) - 3 (0.5) - 4 (0.9)
 *   |                             |
 *   5 (0.3) ------- 6 (-0.2) ---- +
 *   7 (J-space, no gates)
 */
const NODES = [
  node(1, 1.0),
  node(2, 0.5),
  node(3, 0.5),
  node(4, 0.9),
  node(5, 0.3),
  node(6, -0.2),
  node(7, -0.99, 3),
];
const GATES: Record<number, number[]> = {
  1: [2, 5],
  2: [1, 3],
  3: [2, 4],
  4: [3, 6],
  5: [1, 6],
  6: [5, 4],
  7: [],
};
const stargates = new StargateGraph(NODES, (id) => GATES[id] ?? []);

describe('modes', () => {
  it('tells wormhole space and high-sec apart', () => {
    expect(isWormholeSpace(node(7, -0.99, 3))).toBe(true);
    expect(isWormholeSpace(node(8, -1, 25))).toBe(false); // Pochven
    expect(isHighSecSpace(node(1, 1.0))).toBe(true);
    expect(isHighSecSpace({ id: 9, security: 0.9, whClass: 12 })).toBe(false);
  });

  it('routes each mode its own way', () => {
    const graph = new RouteGraph(stargates);
    const route = (mode: Parameters<typeof policyFor>[0], from: number, to: number, closed = 0) =>
      findRoute(graph, from, to, policyFor(mode, closed))?.map((s) => s.id) ?? null;
    expect(route('shortest', 1, 4)).toHaveLength(4); // 3 jumps either way
    expect(route('highsec', 1, 4)).toEqual([1, 2, 3, 4]);
    expect(route('safer', 1, 4)).toEqual([1, 2, 3, 4]);
    expect(route('outlaw', 5, 6)).toEqual([5, 6]);
    expect(route('outlaw', 1, 4)).toBeNull(); // 4 is high-sec
    expect(route('outlaw', 1, 6)).toEqual([1, 5, 6]); // leaving high-sec is fine
    // -2.0: police in 1.0 systems only.
    expect(route('pilot', 2, 4, 1)).toEqual([2, 3, 4]);
    expect(route('pilot', 2, 5, 1)).toEqual([2, 3, 4, 6, 5]); // not through 1 (1.0)
    expect(route('pilot', 2, 5, 0)).toEqual([2, 1, 5]);
  });

  it('respects the avoid list but always leaves the start', () => {
    const graph = new RouteGraph(stargates);
    expect(findRoute(graph, 1, 4, policyFor('shortest'), new Set([5]))?.map((s) => s.id)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(findRoute(graph, 1, 4, policyFor('shortest'), new Set([1, 5]))?.map((s) => s.id)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(findRoute(graph, 1, 4, policyFor('shortest'), new Set([4]))).toBeNull();
  });

  it('adds chain wormholes to the stargates', () => {
    const graph = new RouteGraph(stargates, [{ a: 7, b: 3, via: 'wormhole', connectionId: 'c1' }]);
    expect(findRoute(graph, 7, 1, policyFor('shortest'))).toEqual([
      { id: 7, via: 'start', connectionId: null },
      { id: 3, via: 'wormhole', connectionId: 'c1' },
      { id: 2, via: 'gate', connectionId: null },
      { id: 1, via: 'gate', connectionId: null },
    ]);
    // High-sec only still crosses the chain's wormhole space.
    expect(findRoute(graph, 7, 4, policyFor('highsec'))?.length).toBe(3);
  });
});

describe('jump tables', () => {
  it('match the routes found forward, for every start and mode', () => {
    const graph = new RouteGraph(stargates, [{ a: 7, b: 5, via: 'wormhole', connectionId: 'c1' }]);
    for (const mode of ['shortest', 'safer', 'highsec', 'outlaw'] as const) {
      const policy = policyFor(mode);
      for (const target of [1, 4, 6]) {
        const jumps = jumpsTo(graph, target, policy);
        for (const start of NODES) {
          const route = findRoute(graph, start.id, target, policy);
          expect(jumps[stargates.index.get(start.id)!], `${mode} ${start.id}->${target}`).toBe(
            route ? route.length - 1 : -1,
          );
        }
      }
    }
  });

  it('finds the nearest low-sec system next to a hub', () => {
    const staging = nearestStaging(stargates, 4, policyFor('outlaw'), isLowSec, String);
    expect(staging?.id).toBe(5); // 6 is null-sec; 5 (0.3) is two jumps away
  });
});
