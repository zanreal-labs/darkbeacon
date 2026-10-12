import { describe, expect, it } from 'vitest';
import { freeSpot } from '../map/geometry';
import { slugify } from '../screens/HomePage';
import { systemClass } from './universe';

describe('systemClass', () => {
  it('labels wormhole classes and special space', () => {
    expect(systemClass({ whClass: 3, security: -0.99 })).toEqual({ label: 'C3', token: 'security-wormhole' });
    expect(systemClass({ whClass: 12, security: -0.99 }).label).toBe('Thera');
    expect(systemClass({ whClass: 25, security: -1 }).label).toBe('Pochven');
  });

  it('shows k-space security to one decimal with the matching colour', () => {
    expect(systemClass({ whClass: 7, security: 0.946 })).toEqual({ label: '0.9', token: 'security-high' });
    expect(systemClass({ whClass: 7, security: 0.45 })).toEqual({ label: '0.5', token: 'security-high' });
    expect(systemClass({ whClass: 8, security: 0.04 })).toEqual({ label: '0.1', token: 'security-low' });
    expect(systemClass({ whClass: 9, security: -0.2 })).toEqual({ label: '-0.2', token: 'security-null' });
    expect(systemClass(undefined).label).toBe('?');
  });
});

describe('placement helpers', () => {
  it('moves a new system below the ones it would cover', () => {
    expect(freeSpot({ x: 10.4, y: 0 }, [{ x: 0, y: 0 }])).toEqual({ x: 10, y: 88 });
    expect(freeSpot({ x: 500, y: 0 }, [{ x: 0, y: 0 }])).toEqual({ x: 500, y: 0 });
  });

  it('derives a map address from its name', () => {
    expect(slugify('  My Chain #2 ')).toBe('my-chain-2');
  });
});
