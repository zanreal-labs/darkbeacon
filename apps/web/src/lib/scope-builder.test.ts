import { describe, expect, it } from 'vitest';
import { ApiScope } from '@darkbeacon/shared';
import {
  actionsFor,
  describeGrants,
  describeScopes,
  draftProblem,
  draftScopes,
  emptyDraft,
  expiresAtFor,
  parseIpList,
  type ScopeDraft,
} from './scope-builder';
import { notSharedSentence } from './share-scopes';

const maps = [
  { id: 'm-home', name: 'Home chain' },
  { id: 'm-stage', name: 'Staging' },
];
const draft = (patch: Partial<ScopeDraft>): ScopeDraft => ({ ...emptyDraft(), ...patch });

describe('scope builder', () => {
  it('writes presets for every map, or once per picked map', () => {
    expect(draftScopes(draft({ preset: 'readAll' }))).toEqual(['*:read', 'account:read', 'universe:read']);
    const picked = draftScopes(draft({ preset: 'mapper', maps: 'picked', mapIds: ['m-home', 'm-stage'] }));
    expect(picked).toEqual([
      'map:m-home:*:read',
      'map:m-home:systems:write',
      'map:m-home:connections:write',
      'map:m-home:signatures:write',
      'map:m-stage:*:read',
      'map:m-stage:systems:write',
      'map:m-stage:connections:write',
      'map:m-stage:signatures:write',
      'account:read',
      'universe:read',
    ]);
    // Every scope is one the server's grammar accepts.
    for (const scope of picked) expect(ApiScope.safeParse(scope).success).toBe(true);
  });

  it('writes custom choices only where the action exists, admin never per map', () => {
    expect(actionsFor('webhooks')).toEqual(['manage']);
    expect(actionsFor('connections')).toEqual(['read', 'write']);
    const custom = draft({
      preset: 'custom',
      access: { systems: 'manage', connections: 'manage', admin: 'read', universe: 'read' },
      maps: 'picked',
      mapIds: ['m-home'],
    });
    expect(draftScopes(custom)).toEqual(['map:m-home:systems:manage', 'universe:read', 'admin:read']);
  });

  it('says what is missing', () => {
    expect(draftProblem(draft({ preset: 'custom' }))).toBe('Give the key at least one permission.');
    expect(draftProblem(draft({ maps: 'picked' }))).toBe('Pick at least one map.');
    const many = Array.from({ length: 20 }, (_, i) => `m${i}`);
    expect(draftProblem(draft({ preset: 'mapper', maps: 'picked', mapIds: many }))).toMatch(
      /more than the 64/,
    );
    expect(draftProblem(draft({}))).toBeNull();
  });

  it('reads scopes back as sentences with map names, never ids', () => {
    const lines = describeScopes(
      [
        '*:read',
        'systems:write',
        'map:m-home:signatures:write',
        'map:m-stage:signatures:write',
        'map:m-gone:*',
        'account:read',
        'admin:read',
      ],
      maps,
    );
    expect(lines).toEqual([
      'Read everything, change systems on all your maps',
      'Change signatures on Home chain and Staging',
      'Everything on a map you cannot see',
      'Read the account',
      'Read instance administration',
    ]);
    expect(lines.join(' ')).not.toMatch(/m-home|m-gone/);
    expect(
      describeGrants({
        instanceRole: 'admin',
        allMapsRole: null,
        mapGrants: [
          { mapId: 'm-home', role: 'member' },
          { mapId: 'm-stage', role: 'member' },
        ],
        maps: maps.map((m) => ({ ...m, slug: m.id })),
      }),
    ).toEqual(['Instance admin', 'Member on Home chain and Staging']);
  });

  it('takes expiry choices, IP lists and says what a public link leaves out', () => {
    const now = Date.UTC(2026, 9, 12);
    expect(expiresAtFor('never', '', now)).toBeNull();
    expect(expiresAtFor('7', '', now)).toBe(now + 7 * 86_400_000);
    expect(expiresAtFor('date', 'nope', now)).toBeNull();
    expect(parseIpList('203.0.113.7\n198.51.100.0/24, nope')).toEqual({
      ips: ['203.0.113.7', '198.51.100.0/24'],
      invalid: ['nope'],
    });
    expect(notSharedSentence(['topology', 'connectionStatus'])).toBe(
      'Signatures, bookmark labels, notes and pilots are not shared',
    );
    expect(notSharedSentence(['topology', 'signatures', 'labels', 'intel', 'characters'])).toBe(
      'Connection status is not shared',
    );
  });
});
