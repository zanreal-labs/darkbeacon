import { describe, expect, it } from 'vitest';
import { observe, type CharacterPresence } from './presence.js';
import { jumpInScope, scopeOf } from './scopes.js';

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
    expect(types(presence, true, true)).toEqual(['character.moved']);
    expect(types({ ...presence, solarSystemId: null }, false, true)).toEqual(['character.moved']);
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
