import { describe, expect, it } from 'vitest';
import { cidrContains, ipAllowed, isPrivateAddress, parseCidr, parseIp } from './cidr.js';
import { routes, type RouteDef } from './routes.js';
import { isReservedScope, parseScope, scopeRoleCaps, scopesAllow, type ScopeRequirement } from './scopes.js';

const systemsWrite: ScopeRequirement = { resource: 'systems', action: 'write' };
const mapsRead: ScopeRequirement = { resource: 'maps', action: 'read' };

describe('scope grammar', () => {
  it('parses every form and refuses the rest', () => {
    expect(parseScope('maps:read')).toEqual({ mapId: null, resource: 'maps', action: 'read' });
    expect(parseScope('map:abc-1:signatures:write')).toEqual({
      mapId: 'abc-1',
      resource: 'signatures',
      action: 'write',
    });
    expect(parseScope('map:abc:*')).toEqual({ mapId: 'abc', resource: '*', action: '*' });
    expect(parseScope('*:read')).toEqual({ mapId: null, resource: '*', action: 'read' });
    expect(parseScope('admin:*')).toEqual({ mapId: null, resource: 'admin', action: '*' });
    expect(parseScope('federation:*')).toMatchObject({ resource: 'federation' });
    expect(isReservedScope('federation:*')).toBe(true);
    for (const bad of [
      'maps',
      'maps:delete',
      'map:x:account:read',
      'admin:manage',
      'root:*',
      'map::maps:read',
      'maps:read ',
    ]) {
      expect(parseScope(bad), bad).toBeNull();
    }
  });
});

describe('scope evaluation matrix', () => {
  const cases: Array<[string[], ScopeRequirement, string | null, boolean, string]> = [
    [['systems:write'], systemsWrite, 'm1', true, 'all-maps scope reaches any map'],
    [['systems:read'], systemsWrite, 'm1', false, 'read does not cover write'],
    [['systems:manage'], systemsWrite, 'm1', true, 'manage covers write'],
    [['map:m1:systems:write'], systemsWrite, 'm1', true, 'per-map scope on its map'],
    [['map:m1:systems:write'], systemsWrite, 'm2', false, 'per-map scope on another map'],
    [['map:m1:*'], systemsWrite, 'm1', true, 'everything on one map'],
    [
      ['map:m1:*'],
      { resource: 'account', action: 'read' },
      null,
      false,
      'a map scope never reaches the account',
    ],
    [['*:read'], mapsRead, 'm1', true, 'read everything'],
    [['*:read'], systemsWrite, 'm1', false, 'read everything still cannot write'],
    [['signatures:write'], systemsWrite, 'm1', false, 'other resource'],
    [['maps:read'], { resource: '*', action: 'read' }, 'm1', false, 'snapshots need every resource'],
    [
      ['map:m1:maps:write'],
      { resource: 'maps', action: 'write', global: true },
      null,
      false,
      'creating maps needs the all-maps form',
    ],
    [
      ['maps:write'],
      { resource: 'maps', action: 'write', global: true },
      null,
      true,
      'all-maps form creates maps',
    ],
    [['admin:read'], { resource: 'admin', action: 'write' }, null, false, 'admin read is not write'],
    [['admin:*'], { resource: 'admin', action: 'write' }, null, true, 'admin star'],
    [['*:*'], { resource: 'admin', action: 'read' }, null, false, 'a resource star never means admin'],
    [['systems:write'], 'session', 'm1', false, 'session routes refuse every key'],
    [[], 'none', null, true, 'public routes need nothing'],
    [['federation:*'], mapsRead, 'm1', false, 'reserved scopes grant nothing'],
  ];
  it.each(cases)('%j %j on %s -> %s (%s)', (scopes, requirement, mapId, expected) => {
    expect(scopesAllow(scopes, requirement, mapId)).toBe(expected);
  });

  it('refuses every write to a read-only key', () => {
    expect(scopesAllow(['systems:write'], systemsWrite, 'm1', true)).toBe(false);
    expect(scopesAllow(['systems:write'], { resource: 'systems', action: 'read' }, 'm1', true)).toBe(true);
  });
});

describe('role caps', () => {
  it('turns scopes into the most a key can use of its owner role per map', () => {
    expect(scopeRoleCaps(['maps:read'])).toEqual({ allMaps: 'viewer', maps: {} });
    expect(scopeRoleCaps(['systems:write'])).toEqual({ allMaps: 'member', maps: {} });
    expect(scopeRoleCaps(['maps:read', 'map:m1:webhooks:manage'])).toEqual({
      allMaps: 'viewer',
      maps: { m1: 'admin' },
    });
    expect(scopeRoleCaps(['map:m1:*'])).toEqual({ allMaps: null, maps: { m1: 'admin' } });
    expect(scopeRoleCaps(['map:m1:*'], true)).toEqual({ allMaps: null, maps: { m1: 'viewer' } });
    expect(scopeRoleCaps(['account:read', 'universe:read', 'admin:*'])).toEqual({ allMaps: null, maps: {} });
    // A per-map cap below the all-maps one adds nothing.
    expect(scopeRoleCaps(['*:*', 'map:m1:maps:read'])).toEqual({ allMaps: 'admin', maps: {} });
  });
});

describe('IP allow-lists', () => {
  it('parses IPv4, IPv6 and CIDR ranges', () => {
    expect(parseIp('203.0.113.7')?.version).toBe(4);
    expect(parseIp('2001:db8::1')?.version).toBe(6);
    expect(parseIp('::ffff:203.0.113.7')).toEqual(parseIp('203.0.113.7'));
    expect(parseIp('300.1.1.1')).toBeNull();
    expect(parseIp('01.2.3.4')).toBeNull();
    expect(parseCidr('10.0.0.0/33')).toBeNull();
    expect(cidrContains(parseCidr('203.0.113.0/24')!, parseIp('203.0.113.250')!)).toBe(true);
    expect(cidrContains(parseCidr('2001:db8::/32')!, parseIp('2001:db8:ffff::1')!)).toBe(true);
    expect(cidrContains(parseCidr('2001:db8::/32')!, parseIp('2001:db9::1')!)).toBe(false);
  });

  it('allows everything without a list and only the listed ranges with one', () => {
    expect(ipAllowed([], null)).toBe(true);
    expect(ipAllowed(['203.0.113.0/24'], '203.0.113.9')).toBe(true);
    expect(ipAllowed(['203.0.113.0/24'], '198.51.100.1')).toBe(false);
    expect(ipAllowed(['203.0.113.0/24'], null)).toBe(false);
    expect(ipAllowed(['198.51.100.7'], '198.51.100.7')).toBe(true);
    expect(isPrivateAddress('10.1.2.3')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });
});

describe('route contract', () => {
  it('gives every route a scope decision and keeps key management to sessions', () => {
    const all = Object.values(routes).flatMap((g) =>
      'method' in g ? [g as RouteDef] : Object.values(g as Record<string, RouteDef>),
    );
    for (const route of all) expect(route.scope, route.path).toBeDefined();
    for (const route of all.filter((r) => r.path.includes('api-keys') || r.path.includes('service-keys'))) {
      expect(route.scope, route.path).toBe('session');
    }
    // Admin routes need admin scopes, never a map resource.
    for (const route of all.filter((r) => r.auth === 'admin')) {
      expect(typeof route.scope === 'string' || route.scope.resource === 'admin', route.path).toBe(true);
    }
  });
});
