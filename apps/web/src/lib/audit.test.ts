import { describe, expect, it } from 'vitest';
import type { AuditEntryDto } from '@darkbeacon/shared';
import { channelLabel, readEntry, typesFor } from './audit.js';

const entry = (overrides: Partial<AuditEntryDto>): AuditEntryDto => ({
  id: 'e1',
  stream: 'audit:instance',
  seq: 1,
  type: 'settings.changed',
  occurredAt: 1,
  mapId: null,
  actor: {
    kind: 'account',
    id: 'a',
    accountId: 'a',
    accountName: 'Alice',
    characterId: 9,
    characterName: 'Alice Main',
  },
  channel: { kind: 'web', id: null },
  origin: null,
  op: 'update',
  entity: null,
  diff: {},
  removed: null,
  revertOf: null,
  revertedBy: null,
  revertible: false,
  recorded: true,
  ...overrides,
});

describe('reading audit entries', () => {
  it('words instance changes without ids', () => {
    const reading = readEntry(
      entry({
        diff: {
          eventRetentionDays: { before: null, after: 90 },
          adminGuildId: { before: null, after: '81384788765712384' },
        },
      }),
    );
    expect(reading).toMatchObject({ who: 'Alice', what: 'changed the instance settings', via: 'Web' });
    expect(reading.changes).toEqual([
      { label: 'History kept', before: 'Forever', after: '90 days' },
      { label: 'Discord server', before: '—', after: 'set' },
    ]);
    expect(JSON.stringify(reading)).not.toContain('81384788765712384');
  });

  it('names people, maps and systems it is told about', () => {
    const names = { account: () => 'Bob', map: () => 'Home chain', system: () => 'J123450' };
    expect(
      readEntry(
        entry({
          type: 'access.role_changed',
          entity: { kind: 'account', id: 'b' },
          diff: { role: { before: 'user', after: 'admin' } },
        }),
        names,
      ),
    ).toMatchObject({
      what: 'changed the instance role of Bob',
      changes: [{ label: 'Role', before: 'user', after: 'admin' }],
    });
    expect(readEntry(entry({ type: 'webhook.created', op: 'create', mapId: 'm' }), names).what).toBe(
      'added a webhook to Home chain',
    );
    expect(
      readEntry(
        entry({
          type: 'system.updated',
          entity: { kind: 'system', id: '31000005' },
          diff: { position: { before: { x: 0, y: 0 }, after: { x: 40.4, y: 2 } } },
        }),
        names,
      ),
    ).toMatchObject({
      what: 'moved J123450',
      changes: [{ label: 'Position', before: '0, 0', after: '40, 2' }],
    });
  });

  it('reads changes of Labels and custom labels in words, with label names', () => {
    const names = {
      system: () => 'J123456',
      map: () => 'Home chain',
      systemLabel: (mapId: string, id: string) =>
        mapId === 'm' ? ({ wh1: 'WH1', wh2: 'WH2' } as Record<string, string>)[id] : undefined,
    };
    const system = (diff: AuditEntryDto['diff']) =>
      readEntry(
        entry({ type: 'system.updated', mapId: 'm', entity: { kind: 'system', id: '31000005' }, diff }),
        names,
      );
    expect(system({ systemLabelIds: { before: [], after: ['wh1'] } })).toMatchObject({
      what: 'added label WH1 to J123456',
      changes: [{ label: 'Labels', before: 'none', after: 'WH1' }],
    });
    expect(system({ systemLabelIds: { before: ['wh1', 'wh2'], after: [] } }).what).toBe(
      'removed labels WH1, WH2 from J123456',
    );
    expect(system({ systemLabelIds: { before: ['wh1'], after: ['wh2'] } }).what).toBe(
      'changed the labels of J123456',
    );
    expect(system({ systemLabelIds: { before: [], after: ['gone'] } }).what).toBe('added a label to J123456');
    expect(system({ customLabel: { before: null, after: 'bait' } })).toMatchObject({
      what: 'set the custom label of J123456 to bait',
      changes: [{ label: 'Custom label', before: '—', after: 'bait' }],
    });
    expect(system({ customLabel: { before: 'bait', after: null } }).what).toBe(
      'removed the custom label of J123456',
    );
    // Tags are Tags in the history too.
    expect(
      system({ labelIds: { before: [], after: ['t1'] }, status: { before: 'unknown', after: 'home' } }),
    ).toMatchObject({
      what: 'changed J123456',
      changes: [
        { label: 'Tags', before: 'none', after: '1 set' },
        { label: 'Status', before: 'unknown', after: 'home' },
      ],
    });
    expect(readEntry(entry({ type: 'system_labels.changed', mapId: 'm' }), names).what).toBe(
      'changed the labels of Home chain',
    );
    expect(readEntry(entry({ type: 'labels.changed', mapId: 'm' }), names).what).toBe(
      'changed the tags of Home chain',
    );
  });

  it('says how a change came in and who signs in', () => {
    expect(channelLabel({ kind: 'system', id: 'auto-mapping' })).toBe('Auto-mapping');
    expect(channelLabel({ kind: 'plugin', id: 'discord-notify' })).toBe('Plugin discord-notify');
    const failed = readEntry(
      entry({
        type: 'auth.sign_in_failed',
        op: 'activity',
        actor: {
          kind: 'system',
          id: 'sign-in',
          accountId: null,
          accountName: null,
          characterId: null,
          characterName: null,
        },
        channel: { kind: 'web', id: null },
        diff: {
          signInFailed: { before: null, after: 'discord' },
          reason: { before: null, after: 'Discord sign-in was cancelled' },
        },
      }),
    );
    expect(failed).toMatchObject({
      who: 'Someone',
      what: 'could not sign in with Discord',
      category: 'signIn',
    });
    expect(failed.changes).toEqual([
      { label: 'Reason', before: '—', after: 'Discord sign-in was cancelled' },
    ]);
    expect(
      readEntry(
        entry({
          type: 'auth.signed_in',
          op: 'activity',
          diff: { signedIn: { before: null, after: 'discord' } },
        }),
      ).what,
    ).toBe('signed in with Discord');
    expect(typesFor('signIn')).toBe('auth.*');
    expect(typesFor('all')).toBeUndefined();
  });
});
