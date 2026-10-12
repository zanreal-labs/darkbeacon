import { describe, expect, it } from 'vitest';
import { hasMapRole, resolveMapRole } from './authorization.js';
import { isId, newId } from './ids.js';
import { matchesFilter } from './ports/event-bus.js';
import { parseStream } from './events.js';
import type { DomainEvent } from './events.js';

describe('map roles', () => {
  it('orders roles and never grants blocked', () => {
    expect(hasMapRole('admin', 'manager')).toBe(true);
    expect(hasMapRole('member', 'manager')).toBe(false);
    expect(hasMapRole('blocked', 'viewer')).toBe(false);
    expect(hasMapRole(null, 'viewer')).toBe(false);
  });

  it('picks the highest grant', () => {
    expect(resolveMapRole([])).toBeNull();
    expect(resolveMapRole([{ role: 'viewer' }, { role: 'manager' }, { role: 'member' }])).toBe('manager');
    expect(resolveMapRole([{ role: 'viewer', personal: true }, { role: 'admin' }])).toBe('admin');
  });

  it('lets a personal block beat everything', () => {
    expect(resolveMapRole([{ role: 'admin' }, { role: 'blocked', personal: true }])).toBe('blocked');
    expect(
      resolveMapRole([
        { role: 'admin', personal: true },
        { role: 'blocked', personal: true },
      ]),
    ).toBe('blocked');
  });

  it('lets a group block beat every group grant, but not a personal grant', () => {
    expect(resolveMapRole([{ role: 'blocked' }])).toBe('blocked');
    expect(resolveMapRole([{ role: 'blocked' }, { role: 'admin' }])).toBe('blocked');
    expect(resolveMapRole([{ role: 'admin' }, { role: 'blocked' }, { role: 'member' }])).toBe('blocked');
    expect(resolveMapRole([{ role: 'blocked' }, { role: 'admin' }, { role: 'viewer', personal: true }])).toBe(
      'viewer',
    );
    expect(
      resolveMapRole([
        { role: 'blocked' },
        { role: 'member', personal: true },
        { role: 'manager', personal: true },
      ]),
    ).toBe('manager');
  });

  it('does not depend on the order of grants', () => {
    const grants = [
      { role: 'manager' as const, personal: true },
      { role: 'admin' as const },
      { role: 'blocked' as const },
      { role: 'viewer' as const, personal: true },
    ];
    for (let i = 0; i < grants.length; i++) {
      const rotated = [...grants.slice(i), ...grants.slice(0, i)];
      expect(resolveMapRole(rotated)).toBe('manager');
      expect(resolveMapRole(rotated.reverse())).toBe('manager');
    }
  });
});

describe('ids', () => {
  it('creates sortable v7 ids', () => {
    const a = newId();
    const b = newId();
    expect(isId(a)).toBe(true);
    expect(a < b).toBe(true);
    expect(isId('not-an-id')).toBe(false);
  });
});

describe('streams and filters', () => {
  it('parses stream names', () => {
    expect(parseStream('instance')).toEqual({ kind: 'instance', id: '' });
    expect(parseStream('map:abc')).toEqual({ kind: 'map', id: 'abc' });
    expect(parseStream('map:')).toBeNull();
  });

  it('matches exact and wildcard types', () => {
    const event = { stream: 'map:1', type: 'system.added' } as DomainEvent;
    expect(matchesFilter(event, { types: ['system.*'] })).toBe(true);
    expect(matchesFilter(event, { types: ['system.removed'] })).toBe(false);
    expect(matchesFilter(event, { stream: 'map:2' })).toBe(false);
  });
});
