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
const SAMPLES: Record<AuditedEventType, { data: unknown; before?: unknown }> = {
  'system.added': { data: system },
  'system.updated': { data: { ...system, status: 'hostile' }, before: system },
  'system.removed': { data: { solarSystemId: system.solarSystemId }, before: system },
  'connection.added': { data: connection },
  'connection.updated': { data: { ...connection, massStatus: 'critical' }, before: connection },
  'connection.removed': { data: { id: 'c1' }, before: connection },
  'connection.passage': { data: { connectionId: 'c1', characterId: 9, shipTypeId: 670, mass: 1_200_000 } },
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
  'character.tracked': { data: presence },
  'character.untracked': { data: { characterId: 9 }, before: presence },
  'map.settings_changed': { data: { ...map, name: 'Home' }, before: map },
  'map.created': { data: map },
  'map.removed': { data: { id: 'm' }, before: map },
  'labels.changed': {
    data: { labels: [{ id: 'l', name: 'Home', color: '#22aa66', description: '' }] },
    before: { labels: [] },
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
  'access.rule_added': { data: rule },
  'access.rule_removed': { data: { id: 'r1' }, before: rule },
  'access.role_changed': {
    data: { accountId: 'b', role: 'admin' },
    before: { accountId: 'b', role: 'user' },
  },
  'access.account_changed': { data: { accountId: 'b' } },
  'character.unlinked': { data: { characterId: 9 } },
  'plugin.updated': { data: { ...plugin, enabled: true }, before: plugin },
  'plugin.removed': { data: { id: 'p' }, before: plugin },
  'auth.signed_in': { data: { accountId: 'a', provider: 'discord' } },
  'auth.sign_in_failed': { data: { provider: 'discord', reason: 'cancelled', accountId: null } },
  'auth.signed_out': { data: { accountId: 'a', everywhere: false, device: 'Firefox on Windows' } },
  'account.discord_changed': { data: { accountId: 'a', connected: true } },
  'discord_bot.changed': {
    data: { configured: true, name: 'Beacon' },
    before: { configured: false, name: null },
  },
  'settings.changed': { data: { ...settings, eventRetentionDays: 90 }, before: settings },
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
