import type { AuditEventType, AuditOp, EventType } from '@darkbeacon/shared';
import { asFields, type FieldDiff, type Fields } from './diff.js';

export interface AuditEntity {
  kind: string;
  id: string;
}

/** How the audit trail reads one event type. Every event type has one (a test checks). */
export interface AuditDescriptor {
  /**
   * `update` without a known `before` is recorded as `create` (a plugin installed, a first
   * setting); `delete` keeps `before` as the removed snapshot.
   */
  op: AuditOp;
  /** The thing the event is about. */
  entity(data: Fields, before: Fields | null): AuditEntity | null;
  /** What else it touches, for per-system/per-connection histories: `system:<id>`, `map:<id>`... */
  refs?(data: Fields, before: Fields | null): string[];
  /** Bookkeeping fields that are never diffed (timestamps, the map id). */
  ignore?: readonly string[];
  /** The fields compared, when not the data itself (plugin settings: the values). */
  state?(data: Fields): unknown;
  /** Activity events: the change the data itself describes. Default: every field as new. */
  activity?(data: Fields): FieldDiff;
  /** The character the event is about; it is the character in use when a system process acted. */
  subjectCharacter?(data: Fields): number | null;
}

export type AuditedEventType = EventType | AuditEventType;

const STAMPS = ['createdAt', 'updatedAt', 'mapId', 'provenance'] as const;
const str = (v: unknown) => String(v);
const num = (v: unknown) => (typeof v === 'number' ? v : null);
const ref = (kind: string, id: unknown) => (id === null || id === undefined ? [] : [`${kind}:${str(id)}`]);
const either = (data: Fields, before: Fields | null, key: string) => data[key] ?? before?.[key];

const system = (d: Fields, b: Fields | null): AuditEntity => ({
  kind: 'system',
  id: str(either(d, b, 'solarSystemId')),
});
const connectionRefs = (d: Fields, b: Fields | null) => [
  ...ref('connection', either(d, b, 'id')),
  ...ref('system', either(d, b, 'source')),
  ...ref('system', either(d, b, 'target')),
];
const signatureRefs = (d: Fields, b: Fields | null) => [
  ...ref('signature', either(d, b, 'id')),
  ...ref('system', either(d, b, 'solarSystemId')),
  ...ref('connection', d.connectionId ?? b?.connectionId),
];
const byId =
  (kind: string, key = 'id') =>
  (d: Fields, b: Fields | null): AuditEntity => ({ kind, id: str(either(d, b, key)) });
const character = byId('character', 'characterId');
const characterRefs = (d: Fields) => [...ref('character', d.characterId)];
const subject = (d: Fields) => num(d.characterId);
const change = (before: unknown, after: unknown) => ({ before, after });

const MAP_ENTITY: Partial<AuditDescriptor> = { ignore: ['createdAt', 'updatedAt'] };

const originMap = (value: unknown) => asFields(value)?.mapId;
/** A share between two maps: found in both maps' histories. */
const SHARE: Omit<AuditDescriptor, 'op'> = {
  entity: byId('share'),
  refs: (d, b) => [
    ...ref('map', originMap(d.source) ?? originMap(b?.source)),
    ...ref('map', originMap(d.target) ?? originMap(b?.target)),
  ],
  ignore: ['updatedAt', 'offeredAt', 'acceptedAt', 'id', 'source', 'target'],
};

/**
 * The catalogue: event type -> descriptor. A `Record` over every type of `EventPayloads` and
 * `AuditEventPayloads`, so a new event type does not compile until it says how it is audited.
 */
export const AUDIT_CATALOGUE: Record<AuditedEventType, AuditDescriptor> = {
  'system.added': {
    op: 'create',
    entity: system,
    refs: (d) => ref('system', d.solarSystemId),
    ignore: STAMPS,
  },
  'system.updated': {
    op: 'update',
    entity: system,
    refs: (d) => ref('system', d.solarSystemId),
    ignore: STAMPS,
  },
  'system.removed': {
    op: 'delete',
    entity: system,
    refs: (d) => ref('system', d.solarSystemId),
    ignore: STAMPS,
  },
  'connection.added': { op: 'create', entity: byId('connection'), refs: connectionRefs, ignore: STAMPS },
  'connection.updated': { op: 'update', entity: byId('connection'), refs: connectionRefs, ignore: STAMPS },
  'connection.removed': { op: 'delete', entity: byId('connection'), refs: connectionRefs, ignore: STAMPS },
  'connection.passage': {
    op: 'activity',
    entity: byId('connection', 'connectionId'),
    refs: (d) => [...ref('connection', d.connectionId), ...characterRefs(d)],
    activity: (d) => ({
      shipTypeId: change(null, d.shipTypeId ?? null),
      ...(typeof d.mass === 'number' ? { mass: change(null, d.mass) } : {}),
    }),
    subjectCharacter: subject,
  },
  'signature.added': { op: 'create', entity: byId('signature'), refs: signatureRefs, ignore: STAMPS },
  'signature.updated': { op: 'update', entity: byId('signature'), refs: signatureRefs, ignore: STAMPS },
  'signature.removed': { op: 'delete', entity: byId('signature'), refs: signatureRefs, ignore: STAMPS },
  'character.moved': {
    op: 'activity',
    entity: character,
    refs: (d) => [...characterRefs(d), ...ref('system', d.from), ...ref('system', d.to)],
    activity: (d) => ({ location: change(d.from ?? null, d.to ?? null) }),
    subjectCharacter: subject,
  },
  'character.jumped': {
    op: 'activity',
    entity: character,
    refs: (d) => [...characterRefs(d), ...ref('system', d.from), ...ref('system', d.to)],
    activity: (d) => ({
      location: change(d.from ?? null, d.to ?? null),
      shipTypeId: change(null, d.shipTypeId ?? null),
    }),
    subjectCharacter: subject,
  },
  'character.ship_changed': {
    op: 'update',
    entity: character,
    refs: characterRefs,
    ignore: ['characterId'],
    subjectCharacter: subject,
  },
  'character.online_changed': {
    op: 'activity',
    entity: character,
    refs: characterRefs,
    activity: (d) => ({ online: change(!d.online, d.online) }),
    subjectCharacter: subject,
  },
  'character.tracked': {
    op: 'create',
    entity: character,
    refs: (d) => [...characterRefs(d), ...ref('system', d.solarSystemId)],
    ignore: ['characterId', 'updatedAt'],
    subjectCharacter: subject,
  },
  'character.untracked': {
    op: 'delete',
    entity: character,
    refs: characterRefs,
    ignore: ['characterId', 'updatedAt'],
    subjectCharacter: subject,
  },
  'character.unlinked': {
    op: 'activity',
    entity: character,
    refs: characterRefs,
    activity: () => ({ linked: change(true, false) }),
    subjectCharacter: subject,
  },
  'map.settings_changed': { ...MAP_ENTITY, op: 'update', entity: byId('map'), refs: (d) => ref('map', d.id) },
  'map.created': { ...MAP_ENTITY, op: 'create', entity: byId('map'), refs: (d) => ref('map', d.id) },
  'map.removed': { ...MAP_ENTITY, op: 'delete', entity: byId('map'), refs: (d) => ref('map', d.id) },
  'labels.changed': {
    op: 'update',
    entity: () => ({ kind: 'labels', id: 'map' }),
    state: (d) => ({ labels: d.labels }),
  },
  'system_labels.changed': {
    op: 'update',
    entity: () => ({ kind: 'systemLabels', id: 'map' }),
    state: (d) => ({ systemLabels: d.systemLabels }),
  },
  'map.share.offered': { ...SHARE, op: 'create' },
  'map.share.accepted': { ...SHARE, op: 'update' },
  'map.share.changed': { ...SHARE, op: 'update' },
  'map.share.revoked': { ...SHARE, op: 'delete' },
  'map.sources_changed': {
    op: 'update',
    entity: () => ({ kind: 'sources', id: 'map' }),
    state: (d) => ({
      sources: Array.isArray(d.sources) ? d.sources.map((s: Fields) => str(s.name)) : [],
    }),
  },
  'routes.exits_changed': {
    op: 'update',
    entity: () => ({ kind: 'exits', id: 'map' }),
    // What a person reads: which systems lead out and how far the nearest hub is.
    state: (d) => ({
      exits: Array.isArray(d.exits)
        ? d.exits.map((exit: Fields) => {
            const nearest = asFields(exit.nearest);
            return `${str(exit.name)}${nearest ? ` (${str(nearest.name)} ${str(nearest.jumps)}j)` : ''}`;
          })
        : [],
    }),
    refs: (d, b) => [
      ...new Set(
        [...(Array.isArray(d.exits) ? d.exits : []), ...(Array.isArray(b?.exits) ? b.exits : [])].flatMap(
          (exit: Fields) => ref('system', exit.solarSystemId),
        ),
      ),
    ],
  },
  'routes.hubs_changed': {
    op: 'update',
    entity: () => ({ kind: 'hubs', id: 'map' }),
    state: (d) => ({ hubs: Array.isArray(d.hubs) ? d.hubs.map((hub: Fields) => str(hub.name)) : [] }),
  },
  'ping.created': { op: 'create', entity: byId('ping'), refs: (d) => ref('system', d.solarSystemId) },
  'ping.removed': { op: 'delete', entity: byId('ping'), refs: (d, b) => ref('system', b?.solarSystemId) },
  'access.rule_added': { op: 'create', entity: byId('accessRule'), ignore: ['createdAt', 'mapId'] },
  'access.rule_removed': { op: 'delete', entity: byId('accessRule'), ignore: ['createdAt', 'mapId'] },
  'access.public_link_changed': {
    op: 'update',
    entity: byId('publicLink', 'mapId'),
    refs: (d) => ref('map', d.mapId),
    ignore: ['mapId'],
  },
  'access.role_changed': {
    op: 'update',
    entity: byId('account', 'accountId'),
    refs: (d) => ref('account', d.accountId),
    ignore: ['accountId'],
  },
  'access.account_changed': {
    op: 'activity',
    entity: byId('account', 'accountId'),
    refs: (d) => ref('account', d.accountId),
    activity: () => ({ access: change(null, 'rechecked') }),
  },
  'plugin.updated': { op: 'update', entity: byId('plugin'), ignore: ['installedAt'] },
  'plugin.removed': { op: 'delete', entity: byId('plugin'), ignore: ['installedAt'] },
  'routes.bridges_changed': {
    op: 'activity',
    entity: () => ({ kind: 'bridges', id: 'map' }),
    activity: (d) => {
      const pair = (b: Fields) => `${str(asFields(b.a)?.name)} » ${str(asFields(b.b)?.name)}`;
      const list = (key: string) => (Array.isArray(d[key]) ? (d[key] as Fields[]) : []);
      const diff: FieldDiff = {};
      if (list('added').length > 0) diff.added = change(null, list('added').map(pair));
      if (list('updated').length > 0) diff.updated = change(null, list('updated').map(pair));
      if (list('removed').length > 0) diff.removed = change(null, list('removed').length);
      return diff;
    },
  },
  'routes.settings_changed': { op: 'update', entity: () => ({ kind: 'routingSettings', id: 'map' }) },
  'routes.way_home_changed': {
    op: 'update',
    entity: () => ({ kind: 'wayHome', id: 'map' }),
    state: (d) => ({
      wayHome: Array.isArray(d.routes)
        ? d.routes.map(
            (r: Fields) =>
              `${str(asFields(r.hub)?.name)} ${str(r.jumps)}j via ${str(asFields(r.mouth)?.name)}`,
          )
        : [],
    }),
  },

  // Instance audit (the `audit:instance` stream).
  'auth.signed_in': {
    op: 'activity',
    entity: byId('account', 'accountId'),
    refs: (d) => ref('account', d.accountId),
    activity: (d) => ({ signedIn: change(null, d.provider) }),
  },
  'auth.sign_in_failed': {
    op: 'activity',
    entity: (d) => (d.accountId ? { kind: 'account', id: str(d.accountId) } : null),
    refs: (d) => ref('account', d.accountId),
    activity: (d) => ({ signInFailed: change(null, d.provider), reason: change(null, d.reason) }),
  },
  'auth.signed_out': {
    op: 'activity',
    entity: byId('account', 'accountId'),
    refs: (d) => ref('account', d.accountId),
    activity: (d) => ({
      signedOut: change(
        null,
        d.everywhere ? 'everywhere' : typeof d.device === 'string' ? d.device : 'this browser',
      ),
    }),
  },
  'account.discord_changed': {
    op: 'activity',
    entity: byId('account', 'accountId'),
    refs: (d) => ref('account', d.accountId),
    activity: (d) => ({ discord: change(!d.connected, d.connected) }),
  },
  'discord_bot.changed': { op: 'update', entity: () => ({ kind: 'settings', id: 'discordBot' }) },
  'settings.changed': { op: 'update', entity: () => ({ kind: 'settings', id: 'instance' }) },
  'telemetry.changed': { op: 'update', entity: () => ({ kind: 'settings', id: 'telemetry' }) },
  'theme.installed': { op: 'create', entity: byId('theme') },
  'theme.removed': { op: 'delete', entity: byId('theme') },
  'theme.default_changed': { op: 'update', entity: () => ({ kind: 'settings', id: 'defaultTheme' }) },
  'webhook.created': {
    op: 'create',
    entity: byId('webhook'),
    refs: (d) => ref('map', d.mapId),
    ignore: ['createdAt'],
  },
  'webhook.updated': {
    op: 'update',
    entity: byId('webhook'),
    refs: (d) => ref('map', d.mapId),
    ignore: ['createdAt'],
  },
  'webhook.removed': {
    op: 'delete',
    entity: byId('webhook'),
    refs: (d, b) => ref('map', d.mapId ?? b?.mapId),
    ignore: ['createdAt'],
  },
  'plugin.settings_changed': {
    op: 'update',
    entity: (d) => ({
      kind: 'pluginSettings',
      id: d.mapId ? `${str(d.pluginId)}@${str(d.mapId)}` : str(d.pluginId),
    }),
    refs: (d) => ref('map', d.mapId),
    state: (d) => asFields(d.values) ?? {},
  },
  'backup.completed': {
    op: 'activity',
    entity: byId('backup', 'name'),
    activity: (d) => ({ backup: change(null, d.trigger) }),
  },
  'backup.failed': {
    op: 'activity',
    entity: (d) => (d.name ? { kind: 'backup', id: str(d.name) } : null),
    activity: (d) => ({
      [d.operation === 'restore' ? 'restoreFailed' : 'backupFailed']: change(null, d.message),
    }),
  },
  'backup.restored': {
    op: 'activity',
    entity: byId('backup', 'name'),
    activity: (d) => ({ restored: change(d.preRestore, d.name) }),
  },
  'backup.deleted': {
    op: 'activity',
    entity: byId('backup', 'name'),
    activity: () => ({ deleted: change(null, true) }),
  },
  'backup.downloaded': {
    op: 'activity',
    entity: byId('backup', 'name'),
    activity: () => ({ downloaded: change(null, true) }),
  },
  'backup.settings_changed': { op: 'update', entity: () => ({ kind: 'settings', id: 'backups' }) },
  'api_key.created': {
    op: 'create',
    entity: byId('apiKey'),
    refs: (d) => ref('account', d.ownerAccountId),
  },
  'api_key.updated': {
    op: 'update',
    entity: byId('apiKey'),
    refs: (d) => ref('account', d.ownerAccountId),
  },
  'api_key.rotated': {
    op: 'activity',
    entity: byId('apiKey'),
    refs: (d) => ref('account', d.ownerAccountId),
    activity: (d) => ({ secret: change('old', 'new'), name: change(null, d.name) }),
  },
  'api_key.revoked': {
    op: 'delete',
    entity: byId('apiKey'),
    refs: (d) => ref('account', d.ownerAccountId),
  },
  'oauth.grant_created': {
    op: 'create',
    entity: byId('oauthGrant'),
    refs: (d) => ref('account', d.accountId),
  },
  'oauth.grant_revoked': {
    op: 'delete',
    entity: byId('oauthGrant'),
    refs: (d) => ref('account', d.accountId),
  },
};

/** Types the plugins and future modules add are audited as activity with their data as new. */
export const GENERIC_DESCRIPTOR: AuditDescriptor = { op: 'activity', entity: () => null };

export function describe(type: string): AuditDescriptor {
  return (AUDIT_CATALOGUE as Record<string, AuditDescriptor>)[type] ?? GENERIC_DESCRIPTOR;
}
