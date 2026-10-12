import { describe, expect, it } from 'vitest';
import { observe, type CharacterPresence } from './presence.js';
import { DEFAULT_AUTO_MAP_RULES, jumpAllowed, jumpInScope, scopeOf } from './scopes.js';

const JITA = 30000142;
const PERIMETER = 30000144;

const presence: CharacterPresence = {
  characterId: 1,
  accountId: 'acc',
  name: 'Pilot',
  solarSystemId: JITA,
  shipTypeId: 587,
  shipName: 'Rifter',
  online: true,
  updatedAt: 0,
  docked: false,
};

describe('observe', () => {
  it('reports nothing when nothing changed', () => {
    const result = observe(
      presence,
      {
        online: true,
        location: { solarSystemId: JITA, docked: false },
        ship: { shipTypeId: 587, shipName: 'Rifter' },
        continuous: true,
      },
      10,
    );
    expect(result.changes).toEqual([]);
    expect(result.presence).toEqual(presence);
  });

  it('turns a continuous move into moved + jumped with the new ship', () => {
    const result = observe(
      presence,
      {
        location: { solarSystemId: PERIMETER, docked: false },
        ship: { shipTypeId: 11132, shipName: 'Probe' },
        continuous: true,
      },
      10,
    );
    expect(result.changes.map((c) => c.type)).toEqual([
      'character.ship_changed',
      'character.moved',
      'character.jumped',
    ]);
    expect(result.changes[2]!.data).toEqual({ characterId: 1, from: JITA, to: PERIMETER, shipTypeId: 11132 });
    expect(result.presence).toMatchObject({ solarSystemId: PERIMETER, shipTypeId: 11132, updatedAt: 10 });
  });

  it('does not call a move a jump after a gap, from an unknown place or when arriving docked', () => {
    const types = (p: CharacterPresence, docked: boolean, continuous: boolean) =>
      observe(p, { location: { solarSystemId: PERIMETER, docked }, continuous }, 10).changes.map(
        (c) => c.type,
      );
    expect(types(presence, false, false)).toEqual(['character.moved']);
    expect(types(presence, true, true)).toEqual(['character.moved', 'character.docked_changed']);
    expect(types({ ...presence, solarSystemId: null }, false, true)).toEqual(['character.moved']);
  });

  it('reports docking and undocking', () => {
    const docked = observe(
      presence,
      { location: { solarSystemId: JITA, docked: true }, continuous: true },
      10,
    );
    expect(docked.changes).toEqual([
      { type: 'character.docked_changed', data: { characterId: 1, docked: true } },
    ]);
    expect(docked.presence.docked).toBe(true);
    const again = observe(
      docked.presence,
      { location: { solarSystemId: JITA, docked: true }, continuous: true },
      20,
    );
    expect(again.changes).toEqual([]);
    // Learning it the first time is kept quietly with the next change.
    const first = observe(
      { ...presence, docked: undefined },
      { location: { solarSystemId: JITA, docked: true }, continuous: true },
      10,
    );
    expect(first.changes).toEqual([]);
  });

  it('reports online changes', () => {
    const result = observe(presence, { online: false, continuous: false }, 10);
    expect(result.changes).toEqual([
      { type: 'character.online_changed', data: { characterId: 1, online: false } },
    ]);
    expect(result.presence.online).toBe(false);
  });
});

describe('scopes', () => {
  it('maps SDE wormhole classes to map scopes', () => {
    expect([1, 6, 12, 13, 18].map(scopeOf)).toEqual(Array(5).fill('wormhole'));
    expect([7, 8, 9, 25].map(scopeOf)).toEqual(['high', 'low', 'null', 'pochven']);
    expect([null, undefined, 10, 19].map(scopeOf)).toEqual([null, null, null, null]);
  });

  it('maps a jump when either end is in scope', () => {
    expect(jumpInScope(['wormhole'], 3, 7)).toBe(true);
    expect(jumpInScope(['wormhole'], 7, 3)).toBe(true);
    expect(jumpInScope(['wormhole'], 7, 8)).toBe(false);
    expect(jumpInScope(['wormhole', 'high'], 7, 7)).toBe(true);
    expect(jumpInScope([], 3, 3)).toBe(false);
    expect(jumpInScope(['pochven'], null, 25)).toBe(true);
  });
});

describe('jumpAllowed', () => {
  const HS = 7;
  const LS = 8;
  const NS = 9;
  const C3 = 3;
  const end = (id: number, whClass: number | null) => ({ id, whClass });
  const rules = (over: Partial<Parameters<typeof jumpAllowed>[0]> = {}) => ({
    ...DEFAULT_AUTO_MAP_RULES,
    scopes: ['wormhole' as const],
    ...over,
  });

  it('maps a gate-less known-space pair as a wormhole under the wormhole scope', () => {
    expect(jumpAllowed(rules(), end(1, HS), end(2, LS), false)).toBe(true);
    expect(jumpAllowed(rules(), end(1, NS), end(2, 25), false)).toBe(true);
    // Through a stargate it is travel in known space, out of the wormhole scope.
    expect(jumpAllowed(rules(), end(1, HS), end(2, LS), true)).toBe(false);
    // Without the wormhole scope only the scopes count.
    expect(jumpAllowed(rules({ scopes: ['null'] }), end(1, HS), end(2, LS), false)).toBe(false);
  });

  it('keeps the exit into known space and skips excluded and unknown systems', () => {
    expect(jumpAllowed(rules(), end(1, C3), end(2, HS), false)).toBe(true);
    expect(jumpAllowed(rules(), end(1, C3), end(PERIMETER, HS), false)).toBe(true);
    expect(jumpAllowed(rules(), end(1, C3), end(JITA, HS), false)).toBe(false);
    expect(jumpAllowed(rules({ excludedSystems: [] }), end(1, C3), end(JITA, HS), false)).toBe(true);
    // Abyssal pockets are not in the SDE the map knows.
    expect(jumpAllowed(rules(), end(1, C3), end(2, null), false)).toBe(false);
    expect(jumpAllowed(rules(), end(1, C3), end(1, C3), false)).toBe(false);
  });

  it('needs both ends of a known-space jump in scope under the both rule', () => {
    const high = rules({ scopes: ['high'] });
    expect(jumpAllowed(high, end(1, HS), end(2, LS), true)).toBe(true);
    expect(jumpAllowed({ ...high, gateRule: 'both' }, end(1, HS), end(2, LS), true)).toBe(false);
    expect(jumpAllowed({ ...high, gateRule: 'both' }, end(1, HS), end(2, HS), true)).toBe(true);
    // A wormhole end still suffices while the wormhole scope is on.
    expect(jumpAllowed(rules({ gateRule: 'both' }), end(1, C3), end(2, LS), false)).toBe(true);
    expect(jumpAllowed(rules({ scopes: ['high'], gateRule: 'both' }), end(1, C3), end(2, HS), false)).toBe(
      false,
    );
  });
});
