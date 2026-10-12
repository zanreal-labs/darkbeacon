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

  it('says which key or MCP client made a change, and words keys, links and app approvals', () => {
    const names = { map: (id: string) => (id === 'm' ? 'Home chain' : undefined) };
    expect(
      readEntry(entry({ type: 'labels.changed', channel: { kind: 'api', id: 'k1', name: 'Spreadsheet' } }))
        .what,
    ).toBe('changed the labels via key Spreadsheet');
    expect(
      readEntry(entry({ type: 'labels.changed', channel: { kind: 'mcp', id: 'k1', name: 'Desk' } })).what,
    ).toBe('changed the labels via MCP (Desk)');
    // Entries from before keys had names.
    expect(readEntry(entry({ type: 'labels.changed', channel: { kind: 'api', id: 'k1' } })).what).toBe(
      'changed the labels via an API key',
    );
    expect(channelLabel({ kind: 'mcp', id: null })).toBe('MCP');

    const created = readEntry(
      entry({
        type: 'api_key.created',
        op: 'create',
        diff: {
          name: { before: null, after: 'Bot' },
          kind: { before: null, after: 'svc' },
          scopes: { before: null, after: ['map:m:*:read', 'account:read'] },
        },
      }),
      names,
    );
    expect(created.what).toBe('made the service key Bot');
    expect(created.changes).toContainEqual({
      label: 'Permissions',
      before: '—',
      after: 'Read everything on Home chain; Read the account',
    });
    expect(JSON.stringify(created)).not.toContain('map:m');
    expect(
      readEntry(
        entry({ type: 'api_key.rotated', op: 'activity', diff: { secret: { before: 'old', after: 'new' } } }),
      ).what,
    ).toBe('rotated an API key');

    const shared = readEntry(
      entry({
        type: 'access.sharing_changed',
        mapId: 'm',
        diff: {
          enabled: { before: false, after: true },
          scopes: { before: ['topology'], after: ['topology', 'signatures'] },
          mcpMode: { before: 'off', after: 'public' },
        },
      }),
      names,
    );
    expect(shared.what).toBe('made Home chain public');
    expect(shared.changes).toContainEqual({
      label: 'What the link shows',
      before: 'Systems and connections',
      after: 'Systems and connections, Signatures',
    });
    expect(shared.changes).toContainEqual({ label: 'AI agents', before: 'Off', after: 'Public too' });
    expect(
      readEntry(
        entry({
          type: 'oauth.grant_created',
          op: 'create',
          diff: { clientName: { before: null, after: 'Desk' } },
        }),
      ).what,
    ).toBe('let Desk use Darkbeacon as them');
  });
});
