import type { WormholeEffect } from './wormholes.js';

/**
 * How strongly an effect changes something, per wormhole class. Every modifier of every effect is
 * one of three strengths that grow with the class: full (C1 30 %, +14 points a class, C6 100 %),
 * half (15 % to 50 %) and double (60 % to 200 %, Wolf-Rayet's small weapons). Source: the system
 * effects tables of https://wiki.eveuniversity.org/Wormhole_space (checked 2026-10-12).
 */
type Strength = 'full' | 'half' | 'double';

interface Modifier {
  name: string;
  sign: 1 | -1;
  strength: Strength;
}

const m = (name: string, sign: 1 | -1, strength: Strength): Modifier => ({ name, sign, strength });

export const WORMHOLE_EFFECT_MODIFIERS: Record<WormholeEffect, readonly Modifier[]> = {
  blackHole: [
    m('Missile velocity', 1, 'half'),
    m('Missile explosion velocity', 1, 'full'),
    m('Vorton explosion velocity', 1, 'full'),
    m('Ship velocity', 1, 'full'),
    m('Stasis webifier strength', -1, 'half'),
    m('Inertia', 1, 'half'),
    m('Targeting range', 1, 'full'),
  ],
  cataclysmicVariable: [
    m('Local armor repair', -1, 'half'),
    m('Remote armor repair', 1, 'full'),
    m('Local shield repair', -1, 'half'),
    m('Shield transfer', 1, 'full'),
    m('Capacitor capacity', 1, 'full'),
    m('Capacitor recharge time', 1, 'half'),
    m('Remote capacitor transfer', -1, 'half'),
  ],
  magnetar: [
    m('Weapon damage', 1, 'full'),
    m('Missile explosion radius', 1, 'full'),
    m('Vorton explosion radius', 1, 'full'),
    m('Drone tracking', -1, 'half'),
    m('Targeting range', -1, 'half'),
    m('Tracking speed', -1, 'half'),
    m('Target painter strength', -1, 'half'),
  ],
  pulsar: [
    m('Shield capacity', 1, 'full'),
    m('Armor resists', -1, 'half'),
    m('Capacitor recharge time', -1, 'half'),
    m('Signature radius', 1, 'full'),
    m('Neut and nos amount', 1, 'full'),
  ],
  redGiant: [
    m('Heat damage', 1, 'half'),
    m('Overload bonus', 1, 'full'),
    m('Smartbomb range', 1, 'full'),
    m('Smartbomb damage', 1, 'full'),
    m('Bomb damage', 1, 'full'),
  ],
  wolfRayet: [
    m('Armor HP', 1, 'full'),
    m('Shield resists', -1, 'half'),
    m('Small weapon damage', 1, 'double'),
    m('Signature radius', -1, 'half'),
  ],
};

const FACTOR: Record<Strength, number> = { full: 1, half: 0.5, double: 2 };

/**
 * The effect's modifiers in a class as signed percentages (`{ name: 'Shield capacity', percent:
 * 58 }`); empty outside classes 1-6, which the tables do not cover.
 */
export function effectModifiers(
  effect: WormholeEffect,
  whClass: number | null,
): Array<{ name: string; percent: number }> {
  if (whClass === null || whClass < 1 || whClass > 6) return [];
  const base = 30 + 14 * (whClass - 1);
  return WORMHOLE_EFFECT_MODIFIERS[effect].map((mod) => ({
    name: mod.name,
    percent: mod.sign * base * FACTOR[mod.strength],
  }));
}
