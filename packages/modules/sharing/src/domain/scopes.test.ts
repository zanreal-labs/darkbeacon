import { describe, expect, it } from 'vitest';
import { shareScope, type ChainEntry, type ShareScope, type StampedValue } from '@darkbeacon/shared';
import { refusedFields } from './commands.js';
import { effectiveScopes, FIELD_SCOPES, normalizeScopes, projectEntry } from './scopes.js';

const s = (v: unknown): StampedValue => ({ v, at: 1 });
const ALL_FIELDS = (kind: ChainEntry['kind']) =>
  Object.fromEntries(Object.keys(FIELD_SCOPES[kind]).map((f) => [f, s(f)]));
const present = (kind: ChainEntry['kind']): ChainEntry => ({
  kind,
  key: kind === 'connection' ? '1-2' : kind === 'signature' ? '1:ABC-123' : '1',
  state: 'present',
  born: 1,
  fields: ALL_FIELDS(kind),
});

describe('share scopes', () => {
  it('always include topology and never widen past the offer', () => {
    expect(normalizeScopes(['signatures'])).toEqual(['topology', 'signatures']);
    expect(effectiveScopes(['topology', 'signatures'], null)).toEqual(['topology', 'signatures']);
    expect(effectiveScopes(['topology', 'signatures'], ['signatures', 'intel'])).toEqual([
      'topology',
      'signatures',
    ]);
    expect(effectiveScopes(['topology', 'intel', 'labels'], [])).toEqual(['topology']);
  });

  // The matrix: for every single scope and every kind, exactly the fields of that scope (plus
  // topology) survive, and `local` fields never leave a map.
  const kinds = ['system', 'connection', 'signature', 'character'] as const;
  for (const scope of shareScope.options) {
    it(`lets through only what "${scope}" covers`, () => {
      const scopes = normalizeScopes([scope]);
      for (const kind of kinds) {
        const cut = projectEntry(present(kind), scopes);
        const objectShared =
          kind === 'system' || kind === 'connection'
            ? true
            : kind === 'signature'
              ? scopes.includes('signatures')
              : scopes.includes('characters');
        if (!objectShared) {
          expect(cut, `${kind} under ${scope}`).toBeNull();
          continue;
        }
        const expected = Object.entries(FIELD_SCOPES[kind])
          .filter(([, need]) => need !== 'local' && scopes.includes(need as ShareScope))
          .map(([field]) => field)
          .sort();
        expect(
          Object.keys((cut as Extract<ChainEntry, { state: 'present' }>).fields).sort(),
          `${kind} under ${scope}`,
        ).toEqual(expected);
      }
    });
  }

  it('keeps local fields for the map’s own view only', () => {
    const own = projectEntry(present('system'), 'all') as Extract<ChainEntry, { state: 'present' }>;
    expect(Object.keys(own.fields)).toContain('labelIds');
    const shared = projectEntry(present('system'), [...shareScope.options]) as Extract<
      ChainEntry,
      { state: 'present' }
    >;
    expect(Object.keys(shared.fields)).not.toContain('labelIds');
    expect(Object.keys(shared.fields)).not.toContain('locked');
  });

  it('passes deletions and absences of shared kinds, and drops those of kinds not shared', () => {
    expect(
      projectEntry({ kind: 'signature', key: '1:ABC-123', state: 'deleted', at: 4 }, ['topology']),
    ).toBeNull();
    expect(projectEntry({ kind: 'connection', key: '1-2', state: 'deleted', at: 4 }, ['topology'])).toEqual({
      kind: 'connection',
      key: '1-2',
      state: 'deleted',
      at: 4,
    });
  });

  it('refuses writes to fields a share does not let the map see', () => {
    expect(refusedFields('system', { status: 'hostile', label: 'A' }, ['topology', 'intel'])).toEqual([
      'label',
    ]);
    expect(refusedFields('connection', { mass: { status: 'critical' } }, ['topology'])).toEqual(['mass']);
    expect(
      refusedFields('connection', { mass: { status: 'critical' } }, ['topology', 'connectionStatus']),
    ).toEqual([]);
    expect(refusedFields('signature', { code: 'ABC-124' }, ['topology'])).toEqual(['code']);
    expect(refusedFields('system', { locked: true }, [...shareScope.options])).toEqual(['locked']);
    expect(refusedFields('system', { locked: true }, 'all')).toEqual([]);
  });
});
