import { z } from 'zod';
import type { DomainEvent } from '@wormwright/core';
import type { AccessRuleDto } from './dto/access.js';
import type { InstanceRole } from './dto/identity.js';
import type { PluginDto } from './dto/plugins.js';
import type { ConnectionDto, LabelDto, MapDto, MapSystemDto, SignatureDto } from './dto/mapping.js';

export const DomainEventSchema = z.object({
  id: z.string(),
  seq: z.number().int().positive(),
  stream: z.string(),
  type: z.string(),
  occurredAt: z.number().int(),
  actor: z.object({ kind: z.enum(['account', 'apiToken', 'system', 'plugin']), id: z.string() }),
  data: z.unknown(),
  v: z.literal(1),
});

export interface PingDto {
  id: string;
  solarSystemId: number;
  message: string;
  createdBy: string;
  createdAt: number;
}

/**
 * Event catalogue v1: event type -> `data`. `*.updated` events carry the full object so
 * client reducers can upsert. Interface (not type) so plugins can add entries by
 * declaration merging.
 */
export interface EventPayloads {
  'system.added': MapSystemDto;
  'system.updated': MapSystemDto;
  'system.removed': { solarSystemId: number };
  'connection.added': ConnectionDto;
  'connection.updated': ConnectionDto;
  'connection.removed': { id: string };
  'connection.passage': { connectionId: string; characterId: number; shipTypeId: number | null };
  'signature.added': SignatureDto;
  'signature.updated': SignatureDto;
  'signature.removed': { id: string; solarSystemId: number };
  /** Location changed (null = unknown/offline). Emitted on every map that tracks the character. */
  'character.moved': { characterId: number; from: number | null; to: number | null };
  /** Moved between two known systems; auto-mapping listens to this. */
  'character.jumped': { characterId: number; from: number; to: number; shipTypeId: number | null };
  'character.ship_changed': { characterId: number; shipTypeId: number; shipName: string | null };
  'character.online_changed': { characterId: number; online: boolean };
  'map.settings_changed': MapDto;
  'labels.changed': { labels: LabelDto[] };
  'ping.created': PingDto;
  'ping.removed': { id: string };
  'access.rule_added': AccessRuleDto;
  'access.rule_removed': { id: string };
  /** Instance stream: an account's instance role changed. */
  'access.role_changed': { accountId: string; role: InstanceRole };
  /** Instance stream: a plugin was installed, upgraded, enabled, disabled or failed. */
  'plugin.updated': PluginDto;
  'plugin.removed': { id: string };
}

export type EventType = keyof EventPayloads;

export const EVENT_TYPES = [
  'system.added',
  'system.updated',
  'system.removed',
  'connection.added',
  'connection.updated',
  'connection.removed',
  'connection.passage',
  'signature.added',
  'signature.updated',
  'signature.removed',
  'character.moved',
  'character.jumped',
  'character.ship_changed',
  'character.online_changed',
  'map.settings_changed',
  'labels.changed',
  'ping.created',
  'ping.removed',
  'access.rule_added',
  'access.rule_removed',
  'access.role_changed',
  'plugin.updated',
  'plugin.removed',
] as const satisfies readonly EventType[];

export type TypedEvent<K extends EventType = EventType> = {
  [P in K]: DomainEvent<EventPayloads[P]> & { type: P };
}[K];

export function isEventOfType<K extends EventType>(event: DomainEvent, type: K): event is TypedEvent<K> {
  return event.type === type;
}
