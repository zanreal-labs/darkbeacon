import { describe, expect, it } from 'vitest';
import { connectionFixture } from '../../test/fixtures';
import { wayIn } from './api';

describe('wayIn', () => {
  it('finds the fewest jumps from the home to the shared system, either way along a connection', () => {
    const chain = [
      connectionFixture('a', 1, 2),
      connectionFixture('b', 3, 2),
      connectionFixture('c', 3, 4),
      connectionFixture('d', 1, 5),
      connectionFixture('e', 5, 4),
      connectionFixture('f', 4, 6),
    ];
    const way = wayIn(chain, 1, 6)!;
    expect([...way.connections].sort()).toEqual(['d', 'e', 'f']);
    expect([...way.systems].sort()).toEqual([1, 4, 5, 6]);
    expect(wayIn(chain, 1, 99)).toBeNull();
  });
});
