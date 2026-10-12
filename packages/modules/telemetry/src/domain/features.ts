import type { ActorRef, AuditContext } from '@darkbeacon/core';
import type { ConnectionDto } from '@darkbeacon/shared';
import {
  pluginRef,
  type ChangeSource,
  type ConnectionField,
  type TelemetryServerEventName,
} from './catalogue.js';

/** A committed event as the event log saw it: with `before` for updates. */
export interface ObservedEvent {
  type: string;
  actor: ActorRef;
  data: unknown;
  before?: unknown;
}

/** One telemetry event a domain event stands for, with the account behind it (if any). */
export interface FeatureEvent {
  event: TelemetryServerEventName;
  props: Record<string, unknown>;
  accountId: string | null;
}

/** How the change was made; null for changes nobody made (seeding the demo map, cleanups). */
export function changeSource(context: AuditContext): ChangeSource | null {
  const channel = context.channel;
  if (!channel || channel.kind === 'web') return 'manual';
  if (channel.kind === 'api') return 'api';
  if (channel.kind === 'plugin') return 'plugin';
  return channel.id === 'auto-mapping' ? 'auto' : null;
}

const CONNECTION_FIELDS: ReadonlyArray<[keyof ConnectionDto, (after: ConnectionDto) => ConnectionField]> = [
  ['type', () => 'type'],
  ['timeStatus', (after) => (after.timeStatus === 'eol' ? 'eol' : 'time')],
  ['massStatus', () => 'mass'],
  ['shipSize', () => 'size'],
  ['bubbled', () => 'bubble'],
  ['dangerous', () => 'dangerous'],
  ['massSaved', () => 'mass_saved'],
];

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;

/**
 * The telemetry a committed domain event stands for: which feature was used, never on what.
 * Reverts count once as `history_reverted` (the caller dedupes by `revertOf`), not as the
 * changes they write.
 */
export function featureEvents(event: ObservedEvent, context: AuditContext): FeatureEvent[] {
  const accountId = event.actor.kind === 'account' ? event.actor.id : null;
  const one = (name: TelemetryServerEventName, props: Record<string, unknown> = {}): FeatureEvent[] => [
    { event: name, props, accountId },
  ];
  if (context.revertOf) return one('history_reverted');
  const data = record(event.data);

  switch (event.type) {
    case 'auth.signed_in': {
      const provider = data?.provider;
      return typeof provider === 'string' ? one('signed_in', { method: provider }) : [];
    }
    case 'plugin.updated': {
      // Only an admin's choice; plugins the server enables or disables itself do not count.
      if (accountId === null || !data || typeof data.id !== 'string') return [];
      const before = record(event.before);
      if (before && before.enabled === data.enabled) return [];
      return one(data.enabled ? 'plugin_enabled' : 'plugin_disabled', { plugin: pluginRef(data.id) });
    }
    case 'webhook.created':
      return accountId ? one('webhook_created') : [];
  }

  const source = changeSource(context);
  if (source === null) return [];
  switch (event.type) {
    case 'map.created':
      return one('map_created');
    case 'system.added':
      return one('system_added', { source });
    case 'connection.added':
      return typeof data?.type === 'string' ? one('connection_added', { type: data.type, source }) : [];
    case 'connection.updated': {
      const after = data as ConnectionDto | null;
      const before = record(event.before) as ConnectionDto | null;
      if (!after || !before) return [];
      return CONNECTION_FIELDS.filter(([key]) => before[key] !== after[key]).map(([, field]) => ({
        event: 'connection_updated',
        props: { field: field(after), source },
        accountId,
      }));
    }
    case 'connection.passage':
      return one('passage_logged', {
        source: data?.source ?? 'tracked',
        mode: data?.massMode ?? 'cold',
      });
    case 'labels.changed':
      return one('labels_changed');
    case 'system_labels.changed':
      return one('system_labels_changed');
    case 'ping.created':
      return one('ping_created');
    case 'access.rule_added':
      return typeof data?.subjectKind === 'string'
        ? one('access_rule_added', { subject: data.subjectKind })
        : [];
    default:
      return [];
  }
}
