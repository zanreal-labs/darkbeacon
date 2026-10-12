import { describe, expect, it } from 'vitest';
import { newEvent } from '@darkbeacon/core';
import { AUDIT_EVENT_TYPES, EVENT_TYPES } from '@darkbeacon/shared';
import {
  AUDIT_CATALOGUE,
  GENERIC_DESCRIPTOR,
  describe as describeType,
  type AuditedEventType,
} from './catalogue.js';
import { fieldDiff } from './diff.js';
import { buildAuditRecord, isComplete } from './record.js';

const system = {
  mapId: 'm',
  solarSystemId: 31000005,
  position: { x: 0, y: 0 },
  customName: null,
  temporaryName: null,
  tag: null,
  status: 'unknown',
  description: '',
  labelIds: [],
  systemLabelIds: [],
  customLabel: null,
  locked: false,
  visible: true,
  createdAt: 1,
  updatedAt: 1,
};
const connection = {
  id: 'c1',
  mapId: 'm',
  source: 31000005,
  target: 30000142,
  type: 'wormhole',
  timeStatus: 'normal',
  massStatus: 'fresh',
  shipSize: 'large',
  massSaved: false,
  dangerous: false,
  bubbled: 'none',
  eolAt: null,
  createdAt: 1,
  updatedAt: 1,
};
const signature = {
  id: 's1',
  mapId: 'm',
  solarSystemId: 31000005,
  eveId: 'ABC-123',
  group: 'unknown',
  type: null,
  name: null,
  description: '',
  connectionId: null,
  createdAt: 1,
  updatedAt: 1,
};
const share = {
  id: 'sh1',
  source: { instance: 'local', mapId: 'm' },
  sourceName: 'Corp A',
  target: { instance: 'local', mapId: 'm2' },
  targetName: 'Alliance chain',
  sourceInstanceName: null,
  level: 'read',
  offeredScopes: ['topology'],
  scopes: ['topology'],
  status: 'offered',
  hidden: false,
  offeredAt: 1,
  acceptedAt: null,
  updatedAt: 1,
};
const presence = {
  characterId: 9,
  accountId: 'a',
  name: 'Pilot',
  solarSystemId: 31000005,
  shipTypeId: 670,
  shipName: null,
  online: true,
  updatedAt: 1,
};
const map = {
  id: 'm',
  slug: 'chain',
  name: 'Chain',
  ownerAccountId: 'a',
  settings: { scopes: ['wormhole'] },
  labels: [],
  systemLabels: [],
  createdAt: 1,
  updatedAt: 1,
};
const rule = {
  id: 'r1',
  mapId: 'm',
  subjectKind: 'account',
  subjectId: 'b',
  guildId: null,
  role: 'member',
  createdAt: 1,
};
const plugin = {
  id: 'p',
  name: 'P',
  version: '1.0.0',
  enabled: false,
  error: null,
  hasWeb: false,
  description: null,
  ports: [],
  events: [],
  disabledMapIds: [],
  hasSettings: false,
  installedAt: 1,
};
const settings = {
  adminGuildId: null,
  adminRoleIds: [],
  webhooksToPrivateNetworks: false,
  eventRetentionDays: null,
};
const webhook = {
  id: 'w1',
  mapId: 'm',
  url: 'https://example.com/…',
  events: ['system.*'],
  enabled: true,
  createdAt: 1,
};

/**
 * One real-looking sample per event type: what the emitting use case writes (data) and, for
 * updates and removals, what it passes as `before`. A new event type does not compile until it
 * has a sample here, and the test below fails unless its audit record is complete.
 */
const apiKey = {
  id: 'k1',
  kind: 'pat',
  name: 'Bot',
  scopes: ['maps:read'],
  readOnly: true,
  expiresAt: null,
  allowedIps: [],
  rateLimitPerMinute: null,
  ownerAccountId: 'a',
  instanceRole: null,
  mapGrants: [],
  allMapsRole: null,
};
const sharing = {
  mapId: 'm',
  enabled: false,
  slug: null,
  scopes: ['topology', 'connectionStatus'],
  noindex: true,
  mcpMode: 'authenticated',
  regenerated: false,
};
const BACKUP = 'darkbeacon-20261012T101500Z-v0.1.0-s20.db.gz';
const importSource = { kind: 'wanderer-api' as const, host: 'wanderer.ltd', slug: 'home', name: 'Home' };
const importJob = {
  id: 'j',
  status: 'running' as const,
  source: importSource,
  mode: 'new' as const,
  mapId: 'm',
  mapSlug: 'home',
  mapName: 'Home',
  phase: 'systems',
  done: 0,
  total: 1,
  counts: {
    systems: 1,
    hiddenSystems: 0,
    connections: 0,
    signatures: 0,
    structures: 0,
    comments: 0,
    labels: 0,
    accessRules: 0,
    hubs: 0,
  },
  report: [],
  access: [],
  outcome: {},
  warnings: [],
  error: null,
  createdAt: 1,
  updatedAt: 1,
  finishedAt: null,
  syncId: null,
};

const SAMPLES: Record<AuditedEventType, { data: unknown; before?: unknown }> = {
  'system.added': { data: system },
  'system.updated': { data: { ...system, status: 'hostile' }, before: system },
  'system.removed': { data: { solarSystemId: system.solarSystemId }, before: system },
  'connection.added': { data: connection },
  'connection.updated': { data: { ...connection, massStatus: 'critical' }, before: connection },
  'connection.removed': { data: { id: 'c1' }, before: connection },
  'connection.passage': { data: { connectionId: 'c1', characterId: 9, shipTypeId: 670, mass: 1_200_000 } },
  'connection.passage_updated': {
    data: {
      passageId: 'p1',
      connectionId: 'c1',
      characterId: null,
      shipTypeId: 641,
      mass: 148_400_000,
      massMode: 'hot',
    },
    before: {
      passageId: 'p1',
      connectionId: 'c1',
      characterId: null,
      shipTypeId: 641,
      mass: 98_400_000,
      massMode: 'cold',
    },
  },
  'connection.passage_removed': {
    data: { passageId: 'p1', connectionId: 'c1' },
    before: {
      passageId: 'p1',
      connectionId: 'c1',
      characterId: null,
      shipTypeId: 641,
      mass: 98_400_000,
      from: 31000005,
      to: 30000142,
    },
  },
  'signature.added': { data: signature },
  'signature.updated': { data: { ...signature, group: 'gas' }, before: signature },
  'signature.removed': { data: { id: 's1', solarSystemId: signature.solarSystemId }, before: signature },
  'character.moved': { data: { characterId: 9, from: 30000142, to: 31000005 } },
  'character.jumped': { data: { characterId: 9, from: 30000142, to: 31000005, shipTypeId: 670 } },
  'character.ship_changed': {
    data: { characterId: 9, shipTypeId: 11567, shipName: 'Big' },
    before: { shipTypeId: 670, shipName: null },
  },
  'character.online_changed': { data: { characterId: 9, online: false } },
  'character.docked_changed': { data: { characterId: 9, docked: true } },
  'character.tracked': { data: presence },
  'character.untracked': { data: { characterId: 9 }, before: presence },
  'map.settings_changed': { data: { ...map, name: 'Home' }, before: map },
  'map.created': { data: map },
  'map.removed': { data: { id: 'm' }, before: map },
  'labels.changed': {
    data: { labels: [{ id: 'l', name: 'Home', color: '#22aa66', description: '' }] },
    before: { labels: [] },
  },
  'system_labels.changed': {
    data: { systemLabels: [{ id: 'wh1', name: 'WH1', description: '' }] },
    before: { systemLabels: [] },
  },
  'map.share.offered': { data: share },
  'map.share.accepted': { data: { ...share, status: 'active', acceptedAt: 2 }, before: share },
  'map.share.changed': { data: { ...share, level: 'read-write' }, before: share },
  'map.share.revoked': { data: share, before: share },
  'map.sources_changed': {
    data: { sources: [{ id: 'sh1', name: 'Corp A' }] },
    before: { sources: [] },
  },
  'routes.exits_changed': {
    data: {
      exits: [
        {
          kind: 'connected',
          solarSystemId: 30000144,
          name: 'Perimeter',
          nearest: { name: 'Jita', jumps: 1 },
        },
      ],
    },
    before: { exits: [] },
  },
  'routes.hubs_changed': {
    data: { hubs: [{ solarSystemId: 30000142, name: 'Jita', security: 0.9, kind: 'map', near: null }] },
    before: { hubs: [] },
  },
  'ping.created': {
    data: { id: 'p1', solarSystemId: 31000005, message: 'Help', createdBy: 'a', createdAt: 1 },
  },
  'ping.removed': { data: { id: 'p1' }, before: { id: 'p1', solarSystemId: 31000005, message: 'Help' } },
  'kill.reported': {
    data: {
      id: 123,
      solarSystemId: 31000005,
      time: 1,
      value: 1_000_000,
      npc: false,
      solo: false,
      victim: {
        character: null,
        corporation: null,
        alliance: null,
        ship: { id: 670, name: 'Capsule', ticker: null },
      },
      finalBlow: null,
      attackerCount: 2,
      attackers: [],
    },
  },
  'access.rule_added': { data: rule },
  'access.rule_removed': { data: { id: 'r1' }, before: rule },
  'access.public_link_changed': { data: { ...sharing, enabled: true }, before: sharing },
  'access.role_changed': {
    data: { accountId: 'b', role: 'admin' },
    before: { accountId: 'b', role: 'user' },
  },
  'access.account_changed': { data: { accountId: 'b' } },
  'routes.bridges_changed': {
    data: {
      added: [{ id: 'b1', a: { name: '1DQ1-A' }, b: { name: 'UALX-3' } }],
      updated: [],
      removed: ['b0'],
    },
  },
  'routes.settings_changed': { data: { thera: false }, before: { thera: true } },
  'routes.way_home_changed': {
    data: {
      home: { solarSystemId: 31002531, name: 'J014348' },
      routes: [{ hub: { name: 'Jita' }, jumps: 7, mouth: { name: 'Tama' } }],
    },
    before: { home: null, routes: [] },
  },
  'character.unlinked': { data: { characterId: 9 } },
  'plugin.updated': { data: { ...plugin, enabled: true }, before: plugin },
  'plugin.removed': { data: { id: 'p' }, before: plugin },
  'import.started': { data: { jobId: 'j', source: importSource, mode: 'new' } },
  'import.finished': {
    data: { jobId: 'j', source: importSource, status: 'done', outcome: {}, error: null },
  },
  'import.sync_changed': {
    data: { syncId: 's', source: importSource, enabled: true, intervalMinutes: 15, reason: null },
  },
  'import.progress': {
    data: { ...importJob, status: 'done', phase: 'done' },
    before: { ...importJob, status: 'running', phase: 'systems' },
  },
  'auth.signed_in': { data: { accountId: 'a', provider: 'discord' } },
  'auth.sign_in_failed': { data: { provider: 'discord', reason: 'cancelled', accountId: null } },
  'auth.signed_out': { data: { accountId: 'a', everywhere: false, device: 'Firefox on Windows' } },
  'account.discord_changed': { data: { accountId: 'a', connected: true } },
  'discord_bot.changed': {
    data: { configured: true, name: 'Beacon' },
    before: { configured: false, name: null },
  },
  'settings.changed': { data: { ...settings, eventRetentionDays: 90 }, before: settings },
  'telemetry.changed': { data: { enabled: false }, before: { enabled: true } },
  'theme.installed': { data: { id: 't', name: 'T', version: '1.0.0' } },
  'theme.removed': { data: { id: 't' }, before: { id: 't', name: 'T', version: '1.0.0' } },
  'theme.default_changed': { data: { themeId: 'dark' }, before: { themeId: 'system' } },
  'webhook.created': { data: webhook },
  'webhook.updated': { data: { ...webhook, enabled: false }, before: webhook },
  'webhook.removed': { data: { id: 'w1', mapId: 'm' }, before: webhook },
  'plugin.settings_changed': {
    data: { pluginId: 'discord-notify', mapId: null, values: { username: 'Beacon' } },
    before: { pluginId: 'discord-notify', mapId: null, values: { username: 'Darkbeacon' } },
  },
  'backup.completed': { data: { name: BACKUP, trigger: 'manual', size: 10, schemaVersion: 20 } },
  'backup.failed': { data: { operation: 'backup', trigger: 'scheduled', name: null, message: 'disk full' } },
  'backup.restored': {
    data: { name: BACKUP, source: 'backup', preRestore: BACKUP, migrationsApplied: [] },
  },
  'backup.deleted': { data: { name: BACKUP } },
  'backup.downloaded': { data: { name: BACKUP } },
  'backup.settings_changed': {
    data: { intervalMinutes: 360, keep: 14, maxAgeDays: null, notifyHost: null, notifySuccess: false },
    before: { intervalMinutes: 1440, keep: 14, maxAgeDays: null, notifyHost: null, notifySuccess: false },
  },
  'api_key.created': { data: apiKey },
  'api_key.updated': { data: { ...apiKey, name: 'Bot 2' }, before: apiKey },
  'api_key.rotated': { data: { id: 'k1', name: 'Bot', kind: 'pat', ownerAccountId: 'a' } },
  'api_key.revoked': { data: { id: 'k1', name: 'Bot', kind: 'pat', ownerAccountId: 'a' }, before: apiKey },
  'oauth.grant_created': {
    data: {
      id: 'g1',
      accountId: 'a',
      clientId: 'https://client.example/meta',
      clientName: 'Claude',
      scopes: ['*:read'],
      readOnly: true,
    },
  },
  'oauth.grant_revoked': {
    data: {
      id: 'g1',
      accountId: 'a',
      clientId: 'c',
      clientName: 'Claude',
      scopes: ['*:read'],
      readOnly: true,
    },
    before: {
      id: 'g1',
      accountId: 'a',
      clientId: 'c',
      clientName: 'Claude',
      scopes: ['*:read'],
      readOnly: true,
    },
  },
  'access.rule_changed': { data: { ...rule, role: 'manager' }, before: rule },
  'access.owner_changed': { data: { mapId: 'm', ownerAccountId: 'b', previousOwnerAccountId: 'a' } },
  'map.trashed': { data: { id: 'm', deletedAt: 5 } },
  'map.restored': { data: map },
  'account.disabled_changed': { data: { accountId: 'b', disabled: true, reason: 'spy' } },
  'webhook.secret_rotated': { data: { id: 'w1', mapId: 'm' } },
  'webhook.auto_disabled': { data: { id: 'w1', mapId: 'm', failures: 10, lastError: 'HTTP 500' } },
  'invite.created': { data: { id: 'i1', note: 'new corp', expiresAt: null, maxUses: 5 } },
  'invite.revoked': { data: { id: 'i1' }, before: { id: 'i1', note: null, expiresAt: null, maxUses: 5 } },
  'invite.used': { data: { id: 'i1', accountId: 'b' } },
};

const facts = { accountId: 'a', accountName: 'Alice', characterId: 9, characterName: 'Alice Main' };

describe('audit catalogue', () => {
  it('describes every event type of the catalogue and the instance audit', () => {
    for (const type of [...EVENT_TYPES, ...AUDIT_EVENT_TYPES]) {
      expect(describeType(type), type).not.toBe(GENERIC_DESCRIPTOR);
      expect(AUDIT_CATALOGUE[type], type).toBeDefined();
    }
    expect(Object.keys(AUDIT_CATALOGUE).sort()).toEqual([...EVENT_TYPES, ...AUDIT_EVENT_TYPES].sort());
  });

  it.each([...EVENT_TYPES, ...AUDIT_EVENT_TYPES])(
    'records an actor and a diff or snapshot for %s',
    (type) => {
      const sample = SAMPLES[type];
      const event = newEvent({
        stream: 'map:m',
        type,
        actor: { kind: 'account', id: 'a' },
        data: sample.data,
        occurredAt: 1,
        ...(sample.before === undefined ? {} : { before: sample.before }),
      });
      const { record } = buildAuditRecord(event, {}, facts);
      expect(record.actor).toMatchObject({
        kind: 'account',
        id: 'a',
        accountName: 'Alice',
        characterName: 'Alice Main',
      });
      expect(isComplete(record), `${type}: ${JSON.stringify(record)}`).toBe(true);
      if (record.op === 'delete') expect(record.removed, type).not.toBeNull();
      if (AUDIT_CATALOGUE[type].op === 'update') expect(record.op, `${type} needs its before`).toBe('update');
    },
  );

  it('diffs field by field, ignoring bookkeeping', () => {
    const { record } = buildAuditRecord(
      newEvent({
        stream: 'map:m',
        type: 'system.updated',
        actor: { kind: 'account', id: 'a' },
        data: { ...system, position: { x: 5, y: 0 }, updatedAt: 9 },
        before: system,
        occurredAt: 1,
      }),
      { channel: { kind: 'web' }, origin: { country: 'DE', userAgent: 'x' }, revertOf: 'e0' },
      facts,
    );
    expect(record).toMatchObject({
      op: 'update',
      entity: { kind: 'system', id: '31000005' },
      diff: { position: { before: { x: 0, y: 0 }, after: { x: 5, y: 0 } } },
      channel: { kind: 'web', id: null },
      origin: { country: 'DE', userAgent: 'x' },
      revertOf: 'e0',
    });
    expect(Object.keys(record.diff)).toEqual(['position']);
    expect(fieldDiff({ a: { y: 1, x: 2 } }, { a: { x: 2, y: 1 } })).toEqual({});
  });

  it('finds connection changes by both systems, and tracking by the character', () => {
    const removed = buildAuditRecord(
      newEvent({
        stream: 'map:m',
        type: 'connection.removed',
        actor: { kind: 'account', id: 'a' },
        data: { id: 'c1' },
        before: connection,
        occurredAt: 1,
      }),
      {},
      facts,
    );
    expect(removed.refs.sort()).toEqual([
      'account:a',
      'character:9',
      'connection:c1',
      'system:30000142',
      'system:31000005',
    ]);
    const moved = buildAuditRecord(
      newEvent({
        stream: 'map:m',
        type: 'character.moved',
        actor: { kind: 'system', id: 'tracking' },
        data: { characterId: 9, from: null, to: 31000005 },
        occurredAt: 1,
      }),
      {},
      facts,
    );
    expect(moved.record.channel).toEqual({ kind: 'system', id: 'tracking' });
    expect(moved.record.diff).toEqual({ location: { before: null, after: 31000005 } });
    expect(moved.refs).toContain('system:31000005');
  });
});
