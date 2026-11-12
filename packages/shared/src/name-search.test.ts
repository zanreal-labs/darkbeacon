import { describe, expect, it } from 'vitest';
import { nameMatch } from './name-search.js';

describe('nameMatch', () => {
  it('skips the dashes of a name until the query has one', () => {
    expect(nameMatch('c-j6mt', 'cj6')).toBe(0);
    expect(nameMatch('c-j6mt', 'j6m')).toBe(1);
    expect(nameMatch('c-j6mt', 'c-j6')).toBe(0);
    expect(nameMatch('c-j6mt', 'cj-6')).toBe(-1);
    expect(nameMatch('jita', 'it')).toBe(1);
    expect(nameMatch('jita', 'x')).toBe(-1);
  });
});
