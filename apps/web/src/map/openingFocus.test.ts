import { describe, expect, it } from 'vitest';
import { openingFocus } from './MapCanvas';

describe('openingFocus', () => {
  it('prefers my location, then home, then the system changed last', () => {
    expect(openingFocus({ mine: 1, home: 2, latest: 3 })).toBe(1);
    expect(openingFocus({ mine: null, home: 2, latest: 3 })).toBe(2);
    expect(openingFocus({ mine: null, home: null, latest: 3 })).toBe(3);
    expect(openingFocus({ mine: null, home: null, latest: null })).toBeNull();
  });
});
