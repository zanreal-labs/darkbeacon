import type { AuditChannelDto, AuditEntryDto, ShareScope } from '@darkbeacon/shared';
import { describeScopes } from './scope-builder';
import { SHARE_SCOPE_TEXT } from './share-scopes';

/**
 * Plain-language readings of audit entries, shared by the admin Audit tab and the map's history
 * panels. Ids never reach the reader: callers pass names for systems and maps they know.
 */
export interface AuditNames {
  system?(solarSystemId: number): string | undefined;
  map?(mapId: string): string | undefined;
  account?(accountId: string): string | undefined;
  theme?(themeId: string): string | undefined;
  /** A Label (WH1...) of a map by its id. */
  systemLabel?(mapId: string, labelId: string): string | undefined;
}

export type AuditCategory = 'access' | 'map' | 'intel' | 'tracking' | 'instance' | 'plugins' | 'signIn';

export interface AuditChangeLine {
  label: string;
  before: string;
  after: string;
}

export interface AuditReading {
  /** Who: the person, or the process when no person is behind it. */
  who: string;
  /** What they did, after the name: "changed the instance settings". */
  what: string;
  category: AuditCategory;
  /** Field changes worth showing, already worded. */
  changes: AuditChangeLine[];
  /** How it came in: "Web", "Auto-mapping", "Plugin discord-notify"... */
  via: string;
}

const SYSTEM_PROCESSES: Record<string, string> = {
  'auto-mapping': 'Auto-mapping',
  tracking: 'ESI tracking',
  identity: 'EVE SSO',
  demo: 'Demo setup',
  'sign-in': 'Sign-in',
  'plugin-loader': 'Plugin loader',
  plugins: 'Map cleanup',
  routing: 'Routing',
  'bookmark-numbers': 'Bookmark numbering',
  mapping: 'Mapping',
  passages: 'Passage log',
};

export function channelLabel(channel: AuditChannelDto): string {
  switch (channel.kind) {
    case 'web':
      return 'Web';
    case 'api':
      return 'API key';
    case 'mcp':
      return 'MCP';
    case 'plugin':
      return channel.id ? `Plugin ${channel.id}` : 'Plugin';
    default:
      // Imports name their source: `wanderer:<host>/<slug>`.
      if (channel.id?.startsWith('wanderer:'))
        return `Imported from Wanderer ${channel.id.slice('wanderer:'.length)}`;
      return (channel.id && SYSTEM_PROCESSES[channel.id]) ?? 'Server';
  }
}

const FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  customName: 'Name',
  temporaryName: 'Temporary name',
  tag: 'Tag',
  description: 'Notes',
  labelIds: 'Tags',
  labels: 'Tags',
  systemLabelIds: 'Labels',
  systemLabels: 'Labels',
  customLabel: 'Custom label',
  locked: 'Locked',
  position: 'Position',
  visible: 'On the map',
  type: 'Type',
  timeStatus: 'Lifetime',
  massStatus: 'Mass',
  shipSize: 'Ship size',
  massSaved: 'Mass saved',
  mass: 'Ship mass',
  exits: 'Exits',
  hubs: 'Hubs',
  dangerous: 'Dangerous',
  note: 'Note',
  lifetime: 'Lifetime left',
  kind: 'Kind',
  custom: 'Custom entry',
  bubbled: 'Bubbled',
  eveId: 'Signature',
  group: 'Group',
  name: 'Name',
  connectionId: 'Linked connection',
  bookmarkNumber: 'Bookmark number',
  bookmarkParent: 'Numbered from',
  role: 'Role',
  enabled: 'Enabled',
  error: 'Problem',
  disabledMapIds: 'Switched off on',
  version: 'Version',
  eventRetentionDays: 'History kept',
  adminGuildId: 'Discord server',
  adminRoleIds: 'Discord admin roles',
  webhooksToPrivateNetworks: 'Webhooks to private networks',
  loginMethod: 'Sign-in',
  defaultMapId: 'Map that opens first',
  configured: 'Connected',
  discord: 'Discord',
  channel: 'Channel',
  webhookUrl: 'Webhook',
  url: 'Address',
  events: 'Events',
  themeId: 'Default theme',
  settings: 'Scopes',
  slug: 'Address',
  online: 'Online',
  location: 'Location',
  shipTypeId: 'Ship',
  shipName: 'Ship name',
  subjectKind: 'Who',
  subjectId: 'Subject',
  reason: 'Reason',
  scopes: 'Permissions',
  readOnly: 'Read only',
  expiresAt: 'Expires',
  allowedIps: 'Allowed addresses',
  rateLimitPerMinute: 'Requests a minute',
  instanceRole: 'Instance role',
  mapGrants: 'Map roles',
  allMapsRole: 'Role on every map',
  noindex: 'Hidden from search engines',
  mcpMode: 'AI agents',
  secret: 'Token',
  clientName: 'App',
};

/** Fields that hold ids or internals: shown as "set" / "changed", never as the raw value. */
const OPAQUE = new Set([
  'adminGuildId',
  'adminRoleIds',
  'connectionId',
  'subjectId',
  'disabledMapIds',
  'labelIds',
  'mapGrants',
]);
/** Fields that are noise in a change list. */
const HIDDEN = new Set([
  'id',
  'mapId',
  'accountId',
  'characterId',
  'solarSystemId',
  'ownerAccountId',
  'eolAt',
  'hasWeb',
  'hasSettings',
  'ports',
  'source',
  'target',
  'createdBy',
  'kind',
  'regenerated',
]);

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const API_KEY_VERBS: Record<string, string> = {
  'api_key.created': 'made',
  'api_key.updated': 'changed',
  'api_key.rotated': 'rotated',
  'api_key.revoked': 'revoked',
};

const MCP_MODES: Record<string, string> = {
  off: 'Off',
  authenticated: 'API keys only',
  public: 'Public too',
};

/** API key scopes in words (maps by name), or what a public link shows. */
function scopesValue(v: unknown[], names: AuditNames): string {
  const list = v.map(String);
  if (list.length === 0) return 'none';
  if (!list.some((s) => s.includes(':')))
    return list.map((s) => SHARE_SCOPE_TEXT[s as ShareScope]?.label ?? titleCase(s)).join(', ');
  const ids = [...new Set(list.flatMap((s) => /^map:([^:]+):/.exec(s)?.[1] ?? []))];
  const maps = ids.map((id) => ({ id, name: names.map?.(id) ?? 'a map' }));
  const text = describeScopes(list, maps, { everyMap: 'every map' }).join('; ');
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

/** How a change came in when it was not the web app: "via key Spreadsheet", "via MCP (Client)". */
function viaSuffix(channel: AuditChannelDto): string {
  if (channel.kind === 'api') return channel.name ? ` via key ${channel.name}` : ' via an API key';
  if (channel.kind === 'mcp') return channel.name ? ` via MCP (${channel.name})` : ' via MCP';
  return '';
}

/** Names of a map's Labels by id, as far as they are known ("a label" for the others). */
function labelNames(ids: unknown, mapId: string | null, names: AuditNames): string[] {
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => (mapId && names.systemLabel?.(mapId, String(id))) || 'a label');
}

function value(field: string, v: unknown, names: AuditNames, mapId: string | null = null): string {
  if (field === 'eventRetentionDays') return typeof v === 'number' ? `${v} days` : 'Forever';
  if (field === 'expiresAt') return typeof v === 'number' ? new Date(v).toLocaleDateString() : 'Never';
  if (field === 'rateLimitPerMinute' && v === null) return 'Default';
  if (field === 'mcpMode' && typeof v === 'string') return MCP_MODES[v] ?? v;
  if (field === 'scopes' && Array.isArray(v)) return scopesValue(v, names);
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if ((field === 'location' || field === 'bookmarkParent') && typeof v === 'number')
    return names.system?.(v) ?? 'a known system';
  if (field === 'themeId' && typeof v === 'string') return names.theme?.(v) ?? titleCase(v);
  if (field === 'position' && typeof v === 'object') {
    const p = v as { x: number; y: number };
    return `${Math.round(p.x)}, ${Math.round(p.y)}`;
  }
  if (field === 'lifetime' && typeof v === 'object') return `under ${(v as { mark?: string }).mark ?? '?'}`;
  if (field === 'settings' && typeof v === 'object') {
    const scopes = (v as { scopes?: string[] }).scopes;
    return scopes?.length ? scopes.map(titleCase).join(', ') : '—';
  }
  if ((field === 'labels' || field === 'systemLabels') && Array.isArray(v))
    return v.length ? v.map((l) => (l as { name?: string }).name ?? '').join(', ') : 'none';
  if (field === 'systemLabelIds' && Array.isArray(v))
    return v.length ? labelNames(v, mapId, names).join(', ') : 'none';
  if (OPAQUE.has(field)) return Array.isArray(v) ? (v.length ? `${v.length} set` : 'none') : 'set';
  if (Array.isArray(v)) return v.length ? v.map(String).join(', ') : 'none';
  if (typeof v === 'object') return 'changed';
  const text = String(v);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

export function changeLines(entry: AuditEntryDto, names: AuditNames = {}): AuditChangeLine[] {
  const lines: AuditChangeLine[] = [];
  for (const [field, change] of Object.entries(entry.diff)) {
    const label =
      entry.type === 'access.public_link_changed' && field === 'scopes'
        ? 'What the link shows'
        : FIELD_LABELS[field];
    if (HIDDEN.has(field) || label === undefined) continue;
    const before = value(field, change.before, names, entry.mapId);
    const after = value(field, change.after, names, entry.mapId);
    // Opaque values (ids) that changed but read the same ("set" -> "set") still say so.
    lines.push(before === after ? { label, before: 'changed', after: '' } : { label, before, after });
  }
  return lines;
}

const ROLE_WORDS: Record<string, string> = {
  viewer: 'a viewer',
  member: 'a member',
  manager: 'a manager',
  admin: 'an admin',
  blocked: 'blocked',
};

/** Who an access rule is about, in words (account names when known; never raw ids). */
function ruleSubject(rule: Record<string, unknown>, names: AuditNames): string {
  const id = String(rule.subjectId ?? '');
  switch (rule.subjectKind) {
    case 'account':
      return names.account?.(id) ?? 'an account';
    case 'character':
      return 'a character';
    case 'corporation':
      return 'a corporation';
    case 'alliance':
      return 'an alliance';
    case 'discordRole':
      return 'a Discord role';
    default:
      return 'someone';
  }
}

/**
 * A change of a system's Labels or custom label alone, in words: "added label WH1 to J123456",
 * "set the custom label of J123456 to bait". Null for anything else.
 */
function labelChange(entry: AuditEntryDto, system: string, names: AuditNames): string | null {
  const fields = Object.keys(entry.diff).filter((f) => f !== 'updatedAt');
  if (fields.length !== 1) return null;
  const custom = entry.diff.customLabel;
  if (custom) {
    const after = typeof custom.after === 'string' ? custom.after : '';
    return after ? `set the custom label of ${system} to ${after}` : `removed the custom label of ${system}`;
  }
  const change = entry.diff.systemLabelIds;
  if (!change) return null;
  const before = Array.isArray(change.before) ? change.before.map(String) : [];
  const after = Array.isArray(change.after) ? change.after.map(String) : [];
  const added = after.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !after.includes(id));
  const words = (ids: string[]) => {
    const known = ids.flatMap((id) => (entry.mapId && names.systemLabel?.(entry.mapId, id)) || []);
    if (known.length < ids.length) return ids.length === 1 ? 'a label' : `${ids.length} labels`;
    return `${known.length === 1 ? 'label' : 'labels'} ${known.join(', ')}`;
  };
  if (added.length > 0 && removed.length === 0) return `added ${words(added)} to ${system}`;
  if (removed.length > 0 && added.length === 0) return `removed ${words(removed)} from ${system}`;
  return `changed the labels of ${system}`;
}

const PROVIDERS: Record<string, string> = {
  discord: 'Discord',
  eve: 'EVE Online',
  demo: 'the demo',
  dev: 'a local account',
};

/** A sentence-ready reading of one entry. */
export function readEntry(entry: AuditEntryDto, names: AuditNames = {}): AuditReading {
  const d = (entry.op === 'delete' ? (entry.removed ?? {}) : {}) as Record<string, unknown>;
  const data = { ...d, ...Object.fromEntries(Object.entries(entry.diff).map(([k, c]) => [k, c.after])) };
  const systemId = entry.entity?.kind === 'system' ? Number(entry.entity.id) : undefined;
  const system = systemId ? (names.system?.(systemId) ?? 'a system') : 'a system';
  const via = channelLabel(entry.channel);
  const who =
    entry.actor.accountName ??
    (entry.actor.accountId ? names.account?.(entry.actor.accountId) : undefined) ??
    (entry.actor.kind === 'system'
      ? via
      : entry.actor.kind === 'plugin'
        ? `Plugin ${entry.actor.id}`
        : 'Someone');
  const subject = (entry.entity?.kind === 'account' && names.account?.(entry.entity.id)) || 'someone';
  const mapName = entry.mapId ? (names.map?.(entry.mapId) ?? 'a map') : 'a map';
  const read = (what: string, category: AuditCategory): AuditReading => ({
    who,
    what: what + viaSuffix(entry.channel),
    category,
    changes: changeLines(entry, names),
    via,
  });

  switch (entry.type) {
    case 'auth.signed_in':
      return read(`signed in with ${PROVIDERS[String(entry.diff.signedIn?.after)] ?? 'a sign-in'}`, 'signIn');
    case 'auth.sign_in_failed':
      return {
        ...read(
          `could not sign in with ${PROVIDERS[String(entry.diff.signInFailed?.after)] ?? 'a sign-in'}`,
          'signIn',
        ),
        who: 'Someone',
      };
    case 'auth.signed_out':
      return read(
        entry.diff.signedOut?.after === 'everywhere'
          ? 'signed out everywhere'
          : entry.diff.signedOut?.after && entry.diff.signedOut.after !== 'this browser'
            ? `signed out ${String(entry.diff.signedOut.after)}`
            : 'signed out',
        'signIn',
      );
    case 'access.role_changed':
      return read(`changed the instance role of ${subject}`, 'access');
    case 'access.account_changed':
      return read(`had their map access checked again`, 'access');
    case 'access.rule_added':
    case 'access.rule_removed': {
      const rule = (entry.op === 'delete' ? entry.removed : data) ?? {};
      const target = ruleSubject(rule as Record<string, unknown>, names);
      const role = String(rule.role ?? '');
      return {
        ...read(
          entry.type === 'access.rule_added'
            ? `made ${target} ${ROLE_WORDS[role] ?? role} of ${mapName}`
            : `took ${target} off ${mapName}`,
          'access',
        ),
        changes: [],
      };
    }
    case 'account.discord_changed':
      return read(entry.diff.discord?.after ? 'connected Discord' : 'disconnected Discord', 'access');
    case 'discord_bot.changed':
      return read(
        entry.diff.configured?.after === false ? 'removed the Discord bot' : 'connected the Discord bot',
        'instance',
      );
    case 'settings.changed':
      return read('changed the instance settings', 'instance');
    case 'telemetry.changed':
      return read(
        data.enabled ? 'turned anonymous telemetry on' : 'turned anonymous telemetry off',
        'instance',
      );
    case 'theme.installed':
      return read(`installed the theme ${String(data.name ?? '')}`.trim(), 'instance');
    case 'theme.removed':
      return read(`removed the theme ${String(data.name ?? '')}`.trim(), 'instance');
    case 'theme.default_changed':
      return read('changed the default theme', 'instance');
    case 'webhook.created':
      return read(`added a webhook to ${mapName}`, 'instance');
    case 'webhook.updated':
      return read(`changed a webhook of ${mapName}`, 'instance');
    case 'webhook.removed':
      return read(`removed a webhook from ${mapName}`, 'instance');
    case 'plugin.updated':
      return read(
        entry.op === 'create'
          ? `installed the plugin ${String(data.name ?? '')}`
          : `changed the plugin ${String(entry.entity?.id ?? '')}`,
        'plugins',
      );
    case 'plugin.removed':
      return read(`removed the plugin ${String(data.name ?? entry.entity?.id ?? '')}`, 'plugins');
    case 'plugin.settings_changed':
      return read(
        `changed the settings of ${String(entry.entity?.id ?? 'a plugin').split('@')[0]}`,
        'plugins',
      );
    case 'backup.completed':
      return read(`made a backup (${String(entry.diff.backup?.after ?? 'manual')})`, 'instance');
    case 'backup.failed':
      return read(
        entry.diff.restoreFailed ? 'could not restore a backup' : 'could not make a backup',
        'instance',
      );
    case 'backup.restored':
      return read('restored a backup', 'instance');
    case 'backup.deleted':
      return read('deleted a backup', 'instance');
    case 'backup.downloaded':
      return read('downloaded a backup', 'instance');
    case 'backup.settings_changed':
      return read('changed the backup settings', 'instance');
    case 'character.unlinked':
      return read('unlinked a character', 'access');
    case 'api_key.created':
    case 'api_key.updated':
    case 'api_key.rotated':
    case 'api_key.revoked': {
      const noun = data.kind === 'svc' ? 'service key' : 'API key';
      const name = typeof data.name === 'string' ? data.name : null;
      const verb = API_KEY_VERBS[entry.type] ?? 'changed';
      return read(name ? `${verb} the ${noun} ${name}` : `${verb} an ${noun}`, 'access');
    }
    case 'access.public_link_changed':
      return read(
        entry.diff.regenerated?.after === true
          ? `made a new public link for ${mapName}`
          : entry.diff.enabled?.after === true
            ? `made ${mapName} public`
            : entry.diff.enabled?.after === false
              ? `switched off the public link of ${mapName}`
              : `changed the public link of ${mapName}`,
        'access',
      );
    case 'oauth.grant_created':
      return read(`let ${String(data.clientName ?? 'an app')} use Darkbeacon as them`, 'access');
    case 'oauth.grant_revoked':
      return read(`disconnected ${String(data.clientName ?? 'an app')}`, 'access');
    case 'map.created':
      return read(`created ${mapName}`, 'map');
    case 'map.settings_changed':
      return read(`changed the settings of ${mapName}`, 'map');
    case 'map.removed':
      return read(`deleted ${mapName}`, 'map');
    case 'labels.changed':
      return read(`changed the tags of ${mapName}`, 'map');
    case 'system_labels.changed':
      return read(`changed the labels of ${mapName}`, 'map');
    case 'routes.exits_changed':
      return read("updated the chain's exits", 'map');
    case 'routes.hubs_changed':
      return read(`changed the hubs of ${mapName}`, 'map');
    case 'system.added':
      return read(entry.diff.visible ? `put ${system} back on the map` : `added ${system}`, 'map');
    case 'system.updated':
      return read(
        labelChange(entry, system, names) ??
          (Object.keys(entry.diff).length === 1 && entry.diff.position
            ? `moved ${system}`
            : `changed ${system}`),
        'map',
      );
    case 'system.removed':
      return read(`removed ${system}`, 'map');
    case 'connection.added':
      return read('connected two systems', 'map');
    case 'connection.updated':
      return read('changed a connection', 'map');
    case 'connection.removed':
      return read('removed a connection', 'map');
    case 'connection.passage':
      return read('went through a connection', 'tracking');
    case 'signature.added':
      return read(`added signature ${String(data.eveId ?? '')}`.trim(), 'intel');
    case 'signature.updated':
      return read('changed a signature', 'intel');
    case 'signature.removed':
      return read(`removed signature ${String(data.eveId ?? '')}`.trim(), 'intel');
    case 'character.moved':
    case 'character.jumped':
      return read(`moved to ${value('location', entry.diff.location?.after, names)}`, 'tracking');
    case 'character.ship_changed':
      return read('changed ship', 'tracking');
    case 'character.online_changed':
      return read(entry.diff.online?.after ? 'came online' : 'went offline', 'tracking');
    case 'character.tracked':
      return read('started tracking a character', 'tracking');
    case 'character.untracked':
      return read('stopped tracking a character', 'tracking');
    case 'import.started':
      return read(`started importing from ${String(entry.diff.imported?.after ?? 'Wanderer')}`, 'map');
    case 'import.finished': {
      const status = entry.diff.status?.after;
      const source = String(entry.diff.imported?.after ?? 'Wanderer');
      return read(
        status === 'done'
          ? `imported from ${source}`
          : status === 'cancelled'
            ? `stopped importing from ${source}`
            : `could not import from ${source}`,
        'map',
      );
    }
    case 'import.sync_changed':
      return read(
        entry.diff.syncing?.after
          ? `started syncing from ${String(entry.diff.source?.after ?? 'Wanderer')}`
          : `stopped syncing from ${String(entry.diff.source?.after ?? 'Wanderer')}`,
        'map',
      );
    default:
      return read(`made a change (${entry.type})`, 'map');
  }
}

/** Filters of the instance audit, as the admin picks them. */
export const INSTANCE_AUDIT_KINDS = [
  { value: 'all', label: 'Everything', types: undefined },
  { value: 'signIn', label: 'Sign-ins', types: ['auth.*'] },
  {
    value: 'access',
    label: 'Roles and access',
    types: ['access.*', 'character.unlinked', 'account.*', 'api_key.*', 'oauth.*'],
  },
  { value: 'plugins', label: 'Plugins', types: ['plugin.*'] },
  { value: 'instance', label: 'Settings and themes', types: ['settings.*', 'theme.*', 'discord_bot.*'] },
  { value: 'webhooks', label: 'Webhooks', types: ['webhook.*'] },
] as const;

/** `?types=` for a filter value. */
export function typesFor(kind: string): string | undefined {
  return INSTANCE_AUDIT_KINDS.find((k) => k.value === kind)?.types?.join(',');
}

/** Retention choices offered to admins (days; null keeps everything). */
export const RETENTION_CHOICES: ReadonlyArray<{ value: string; label: string; days: number | null }> = [
  { value: 'forever', label: 'Forever', days: null },
  { value: '730', label: '2 years', days: 730 },
  { value: '365', label: '1 year', days: 365 },
  { value: '180', label: '6 months', days: 180 },
  { value: '90', label: '90 days', days: 90 },
  { value: '30', label: '30 days', days: 30 },
];
