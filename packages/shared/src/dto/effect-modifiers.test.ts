import { describe, expect, it } from 'vitest';
import { effectModifiers } from './effect-modifiers.js';

describe('wormhole effect modifiers', () => {
  it('grows with the class as the EVE University tables list it', () => {
    expect(effectModifiers('pulsar', 1)).toEqual([
      { name: 'Shield capacity', percent: 30 },
      { name: 'Armor resists', percent: -15 },
      { name: 'Capacitor recharge time', percent: -15 },
      { name: 'Signature radius', percent: 30 },
      { name: 'Neut and nos amount', percent: 30 },
    ]);
    expect(effectModifiers('pulsar', 3)[0]).toEqual({ name: 'Shield capacity', percent: 58 });
    expect(effectModifiers('wolfRayet', 6).find((m) => m.name === 'Small weapon damage')!.percent).toBe(200);
    expect(effectModifiers('blackHole', 4).find((m) => m.name === 'Stasis webifier strength')!.percent).toBe(
      -36,
    );
    expect(effectModifiers('magnetar', 13)).toEqual([]);
  });
});
