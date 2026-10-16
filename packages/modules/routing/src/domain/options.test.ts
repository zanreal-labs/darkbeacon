import { describe, expect, it } from 'vitest';
import { cleanSystemName, farSideOf, isForeignBridge, parseBridgeLines } from './bridges.js';
import { findRoute, jumpsTo, NO_TRANSIT, RouteGraph, routesFrom, StargateGraph, ZARZAKH } from './graph.js';
import { policyFor, type RouteNode } from './modes.js';
import { DEFAULT_ROUTE_OPTIONS, edgeKey, usableEdge, withAvoidance, type RoutedEdge } from './options.js';

const node = (
  id: number,
  security: number,
  whClass: number | null = null,
  invasion?: RouteNode['invasion'],
) => ({
  id,
  security,
  whClass: whClass ?? (security >= 0.45 ? 7 : security > 0 ? 8 : 9),
  ...(invasion ? { invasion } : {}),
});

/**
 *   1 - 2 - 3 - 4          (a long way round)
 *   |               |
 *   +-- Zarzakh ----+      (1 - Z - 4: the short way, through Zarzakh)
 *   5 (Pochven), 6 (EDENCOM), 7 (J-space): 1 - 6 - 4 and 1 - 5 - 4
 */
const NODES = [
  node(1, 0.3),
  node(2, 0.3),
  node(3, 0.3),
  node(4, 0.3),
  node(ZARZAKH, -1, 9),
  node(5, -1, 25, 'final'),
  node(6, 0.6, null, 'edencom'),
  node(7, -1, 3),
];
const GATES: Record<number, number[]> = {
  1: [2, ZARZAKH],
  2: [1, 3],
  3: [2, 4],
  4: [3, ZARZAKH],
  [ZARZAKH]: [1, 4],
};
const stargates = new StargateGraph(NODES, (id) => GATES[id] ?? []);
const ids = (steps: { id: number }[] | null) => steps?.map((s) => s.id) ?? null;

describe('Zarzakh', () => {
  const graph = new RouteGraph(stargates);
  const shortest = policyFor('shortest');

  it('is never passed through, but routes start and end there', () => {
    expect(NO_TRANSIT.has(ZARZAKH)).toBe(true);
    expect(ids(findRoute(graph, 1, 4, shortest))).toEqual([1, 2, 3, 4]);
    expect(ids(findRoute(graph, 1, ZARZAKH, shortest))).toEqual([1, ZARZAKH]);
    expect(ids(findRoute(graph, ZARZAKH, 4, shortest))).toEqual([ZARZAKH, 4]);
    const table = jumpsTo(graph, 4, shortest);
    expect(table[stargates.index.get(1)!]).toBe(3);
    expect(table[stargates.index.get(ZARZAKH)!]).toBe(1);
    expect(ids(routesFrom(graph, 1, shortest).to(4))).toEqual([1, 2, 3, 4]);
  });
});

describe('route tree', () => {
  it('finds the same routes as one search per target', () => {
    const graph = new RouteGraph(stargates, [
      { a: 7, b: 2, via: 'wormhole', connectionId: 'c1' },
      { a: 7, b: 4, via: 'wormhole', connectionId: 'c2' },
    ]);
    for (const mode of ['shortest', 'safer', 'outlaw'] as const) {
      const policy = policyFor(mode);
      const tree = routesFrom(graph, 1, policy);
      for (const target of [2, 3, 4, 7, ZARZAKH]) {
        expect(ids(tree.to(target)), `${mode} ${target}`).toEqual(ids(findRoute(graph, 1, target, policy)));
      }
    }
    expect(routesFrom(graph, 99, policyFor('shortest')).to(1)).toBeNull();
  });

  it('keeps where an edge came from', () => {
    const graph = new RouteGraph(stargates, [
      { a: 1, b: 4, via: 'bridge', connectionId: null, origin: 'ansiblex' },
    ]);
    expect(routesFrom(graph, 1, policyFor('shortest')).to(4)).toEqual([
      { id: 1, via: 'start', connectionId: null },
      { id: 4, via: 'bridge', connectionId: null, origin: 'ansiblex' },
    ]);
  });
});

describe('route options', () => {
  const edge = (patch: Partial<RoutedEdge> & Partial<RoutedEdge['state']> = {}): RoutedEdge => ({
    a: 1,
    b: 7,
    via: patch.via ?? 'wormhole',
    connectionId: 'c',
    ...(patch.origin ? { origin: patch.origin } : {}),
    state: {
      timeStatus: patch.timeStatus ?? 'normal',
      massStatus: patch.massStatus ?? 'fresh',
      shipSize: patch.shipSize ?? 'large',
      dangerous: patch.dangerous ?? false,
      bubbled: patch.bubbled ?? 'none',
    },
  });
  const ok = (e: RoutedEdge, options: Partial<typeof DEFAULT_ROUTE_OPTIONS> = {}, foreign = false) =>
    usableEdge(e, { ...DEFAULT_ROUTE_OPTIONS, ...options }, () => foreign);

  it('skips the connections asked for', () => {
    expect(ok(edge())).toBe(true);
    expect(ok(edge({ timeStatus: 'eol' }), { skip: ['eol'] })).toBe(false);
    expect(ok(edge({ massStatus: 'critical' }), { skip: ['critical'] })).toBe(false);
    expect(ok(edge({ shipSize: 'small' }), { skip: ['frigate'] })).toBe(false);
    expect(ok(edge({ shipSize: 'medium' }), { skip: ['medium'] })).toBe(false);
    expect(ok(edge({ shipSize: 'medium' }), { skip: ['frigate'] })).toBe(true);
    expect(ok(edge({ dangerous: true }), { skip: ['dangerous'] })).toBe(false);
    expect(ok(edge({ bubbled: 'source' }), { skip: ['bubbled'] })).toBe(false);
  });

  it('leaves wormholes, EVE-Scout holes and bridges out on request', () => {
    expect(ok(edge(), { avoidSpace: ['wormholes'] })).toBe(false);
    expect(ok(edge({ via: 'bridge' }), { avoidSpace: ['wormholes'] })).toBe(true);
    expect(ok(edge({ origin: 'eve-scout' }), { thera: false })).toBe(false);
    expect(ok(edge({ via: 'bridge' }), { bridges: false })).toBe(false);
    // Capitals may not use an Ansiblex since 2026-09-22.
    expect(ok(edge({ via: 'bridge' }), { capital: true })).toBe(false);
    expect(ok(edge({ via: 'bridge' }), {}, true)).toBe(false);
    expect(ok(edge(), {}, true)).toBe(true);
  });

  it('keys graphs by what changes their edges', () => {
    expect(edgeKey(DEFAULT_ROUTE_OPTIONS, null)).toBe(
      edgeKey({ ...DEFAULT_ROUTE_OPTIONS, avoid: [1] }, null),
    );
    expect(edgeKey(DEFAULT_ROUTE_OPTIONS, 1)).not.toBe(edgeKey(DEFAULT_ROUTE_OPTIONS, 2));
    expect(edgeKey({ ...DEFAULT_ROUTE_OPTIONS, capital: true }, 1)).toBe(
      edgeKey({ ...DEFAULT_ROUTE_OPTIONS, capital: true }, 2),
    );
  });

  it('keeps out of avoided systems and space, but still starts and ends anywhere', () => {
    const graph = new RouteGraph(stargates, [
      { a: 1, b: 5, via: 'wormhole', connectionId: 'p1' },
      { a: 5, b: 4, via: 'wormhole', connectionId: 'p2' },
      { a: 1, b: 6, via: 'wormhole', connectionId: 'e1' },
      { a: 6, b: 4, via: 'wormhole', connectionId: 'e2' },
    ]);
    const route = (avoidSpace: Parameters<typeof withAvoidance>[1]['avoidSpace'], avoid: number[] = []) =>
      ids(findRoute(graph, 1, 4, withAvoidance(policyFor('shortest'), { avoidSpace, avoid })));
    expect(route([])).toHaveLength(3);
    expect(route(['pochven', 'edencom'])).toEqual([1, 2, 3, 4]);
    expect(route(['pochven'])).toEqual([1, 6, 4]);
    expect(route(['edencom'])).toEqual([1, 5, 4]);
    expect(route(['pochven'], [6])).toEqual([1, 2, 3, 4]);
    expect(
      ids(
        findRoute(graph, 5, 4, withAvoidance(policyFor('shortest'), { avoidSpace: ['pochven'], avoid: [] })),
      ),
    ).toEqual([5, 4]);
    expect(withAvoidance(policyFor('shortest'), { avoidSpace: [], avoid: [] }).key).toBe('shortest');
  });
});

describe('bridge lists', () => {
  it('reads what people paste', () => {
    const { pairs, unreadable } = parseBridgeLines(
      [
        'UALX-3 » 1DQ1-A',
        '1DQ1-A » 8WA-Z6 - Home Bridge',
        'T5ZI-S -> 1DQ1-A',
        'PQRE-W 1-1 --> A-7XFN 3-1',
        'UALX-3 » 1DQ1-A - Ansiblex Jump Gate',
        'Ansiblex Jump Bridge\tE3OI-U » 9-F0B2 - Fast Lane\t12 km',
        'D-W7F0 - Y-PNRL',
        'K-6K16,  RZC-16',
        'O-IOAI\t4O-239',
        'FWST-8 | J-LPX7',
        '# comment',
        '',
        'Jita',
      ].join('\n'),
    );
    expect(pairs.map((p) => [p.from, p.to])).toEqual([
      ['UALX-3', '1DQ1-A'],
      ['1DQ1-A', '8WA-Z6'],
      ['T5ZI-S', '1DQ1-A'],
      ['PQRE-W', 'A-7XFN'],
      ['UALX-3', '1DQ1-A'],
      ['E3OI-U', '9-F0B2'],
      ['D-W7F0', 'Y-PNRL'],
      ['K-6K16', 'RZC-16'],
      ['O-IOAI', '4O-239'],
      ['FWST-8', 'J-LPX7'],
    ]);
    expect(unreadable).toEqual([{ line: 13, text: 'Jita', reason: 'Two system names were expected' }]);
  });

  it('splits lines without an arrow where both halves are systems', () => {
    const systems = new Set(
      [
        'PQRE-W',
        'A-7XFN',
        'O-VWPB',
        'Atioth',
        '3-LJW3',
        'M-ZJWJ',
        'UALX-3',
        '1DQ1-A',
        'Old Man Star',
        'Jita',
      ].map((n) => n.toLowerCase()),
    );
    const isSystem = (name: string) => systems.has(name.toLowerCase());
    const { pairs, unreadable } = parseBridgeLines(
      [
        'PQRE-W A-7XFN',
        'O-VWPB Atioth',
        '3-LJW3 M-ZJWJ',
        'UALX-3 » 1DQ1-A - Home Bridge',
        '3-LJW3\tM-ZJWJ',
        '3-LJW3-M-ZJWJ',
        '3-LJW3 - M-ZJWJ',
        '3-LJW3 -> M-ZJWJ',
        '3-LJW3 <-> M-ZJWJ',
        '3-LJW3,M-ZJWJ',
        'Old Man Star Jita',
        '  PQRE-W   A-7XFN  ',
        'PQRE-W A-7XFN Atioth',
      ].join('\n'),
      isSystem,
    );
    expect(pairs.map((p) => [p.from, p.to])).toEqual([
      ['PQRE-W', 'A-7XFN'],
      ['O-VWPB', 'Atioth'],
      ['3-LJW3', 'M-ZJWJ'],
      ['UALX-3', '1DQ1-A'],
      ['3-LJW3', 'M-ZJWJ'],
      ['3-LJW3', 'M-ZJWJ'],
      ['3-LJW3', 'M-ZJWJ'],
      ['3-LJW3', 'M-ZJWJ'],
      ['3-LJW3', 'M-ZJWJ'],
      ['3-LJW3', 'M-ZJWJ'],
      ['Old Man Star', 'Jita'],
      ['PQRE-W', 'A-7XFN'],
    ]);
    // Three names: no split names two systems, and three words are not a pair.
    expect(unreadable).toEqual([
      { line: 13, text: 'PQRE-W A-7XFN Atioth', reason: 'Two system names were expected' },
    ]);
    // Without the names a space still splits two words; unknown ones are reported later.
    expect(parseBridgeLines('PQRE-W A-7XFN').pairs.map((p) => [p.from, p.to])).toEqual([
      ['PQRE-W', 'A-7XFN'],
    ]);
  });

  it('keeps names that look like grid markers', () => {
    expect(cleanSystemName('5-3722')).toBe('5-3722');
    expect(cleanSystemName(' PQRE-W 1-1 ')).toBe('PQRE-W');
    expect(cleanSystemName('(Ansiblex) 1DQ1-A -')).toBe('1DQ1-A');
  });

  it('finds where a gate leads from its name', () => {
    const names: Record<string, number> = { '1dq1-a': 1, '8wa-z6': 2 };
    const byName = (n: string) => names[n.toLowerCase()] ?? null;
    expect(farSideOf('1DQ1-A » 8WA-Z6 - Home', 1, byName)).toBe(2);
    expect(farSideOf('1DQ1-A » 8WA-Z6 - Home', 2, byName)).toBe(1);
    expect(farSideOf('Our gate', 1, byName)).toBeNull();
  });

  it('leaves out bridges proven to belong to another alliance', () => {
    const holders: Record<number, number> = { 1: 99, 2: 99, 3: 77 };
    const holderOf = (id: number) => holders[id] ?? null;
    expect(isForeignBridge(1, 2, 99, holderOf)).toBe(false);
    expect(isForeignBridge(1, 3, 99, holderOf)).toBe(true);
    expect(isForeignBridge(1, 2, 77, holderOf)).toBe(true);
    expect(isForeignBridge(1, 4, 77, holderOf)).toBe(true);
    expect(isForeignBridge(4, 5, 77, holderOf)).toBe(false);
    expect(isForeignBridge(1, 3, null, holderOf)).toBe(false);
  });
});
