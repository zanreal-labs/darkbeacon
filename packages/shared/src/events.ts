import { z } from 'zod';
import type { DomainEvent } from '@darkbeacon/core';
import type { AccessRuleDto } from './dto/access.js';
import type { InstanceRole } from './dto/identity.js';
import type { PluginDto } from './dto/plugins.js';
import type { ConnectionDto, LabelDto, MapDto, MapSystemDto, SignatureDto } from './dto/mapping.js';
import type { HubDto, MapExitDto } from './dto/routing.js';
import type { CharacterPresenceDto } from './dto/tracking.js';
import type { MapShareDto, MapSourceDto } from './dto/sharing.js';
import type { CommentDto } from './dto/comments.js';
import type { StructureDto } from './dto/structures.js';

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
  /**
   * A tracked character jumped through a connection on the map. `mass` (hull mass in kg, null for
   * unknown ships), `from`, `to` and `passageId` were added later and are optional for readers.
   */
  'connection.passage': {
    connectionId: string;
    characterId: number;
    shipTypeId: number | null;
    mass?: number | null;
    from?: number;
    to?: number;
    passageId?: string;
  };
  'signature.added': SignatureDto;
  'signature.updated': SignatureDto;
  'signature.removed': { id: string; solarSystemId: number };
  /** Location changed (null = unknown/offline). Emitted on every map that tracks the character. */
  'character.moved': { characterId: number; from: number | null; to: number | null };
  /** Moved between two known systems; auto-mapping listens to this. */
  'character.jumped': { characterId: number; from: number; to: number; shipTypeId: number | null };
  'character.ship_changed': { characterId: number; shipTypeId: number; shipName: string | null };
  'character.online_changed': { characterId: number; online: boolean };
  /** A character started being tracked on the map. */
  'character.tracked': CharacterPresenceDto;
  'character.untracked': { characterId: number };
  'map.settings_changed': MapDto;
  /** First event of a map stream. */
  'map.created': MapDto;
  /** Last event of a map stream: the map and everything on it is gone. */
  'map.removed': { id: string };
  'labels.changed': { labels: LabelDto[] };
  /** On the source's and the target's stream: a source admin offered the map to another map. */
  'map.share.offered': MapShareDto;
  /** On both streams: the target's admin accepted; the target merges the source from now on. */
  'map.share.accepted': MapShareDto;
  /** On both streams: level, scopes or hidden changed. */
  'map.share.changed': MapShareDto;
  /** On both streams: the share ended (revoked by either side, or an offer declined). */
  'map.share.revoked': MapShareDto;
  /**
   * The maps merged into this one changed (published after the merged objects themselves were
   * added or removed); an empty list on a standard map means it no longer merges anything.
   */
  'map.sources_changed': { sources: MapSourceDto[] };
  /** The chain's exits changed (recomputed after connection and system changes). */
  'routes.exits_changed': { exits: MapExitDto[] };
  /** The map's own hubs were replaced (manager+). */
  'routes.hubs_changed': { hubs: HubDto[] };
  'ping.created': PingDto;
  'ping.removed': { id: string };
  'access.rule_added': AccessRuleDto;
  'access.rule_removed': { id: string };
  /** Instance stream: an account's instance role changed. */
  'access.role_changed': { accountId: string; role: InstanceRole };
  /**
   * Instance stream: something an account is matched by changed (characters, corporation or
   * alliance, Discord roles) or its sessions ended. Map access of the account is re-checked.
   */
  'access.account_changed': { accountId: string };
  /** Instance stream: a character left its account (unlinked, or claimed by a new owner). */
  'character.unlinked': { characterId: number };
  /** Instance stream: a plugin was installed, upgraded, enabled, disabled or failed. */
  'plugin.updated': PluginDto;
  'plugin.removed': { id: string };
  /** A comment was added to a system of the map. */
  'comment.added': CommentDto;
  'comment.removed': { id: string; solarSystemId: number };
  'structure.added': StructureDto;
  'structure.updated': StructureDto;
  'structure.removed': { id: string; solarSystemId: number };
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
  'character.tracked',
  'character.untracked',
  'map.settings_changed',
  'map.created',
  'map.removed',
  'labels.changed',
  'map.share.offered',
  'map.share.accepted',
  'map.share.changed',
  'map.share.revoked',
  'map.sources_changed',
  'routes.exits_changed',
  'routes.hubs_changed',
  'ping.created',
  'ping.removed',
  'access.rule_added',
  'access.rule_removed',
  'access.role_changed',
  'access.account_changed',
  'character.unlinked',
  'plugin.updated',
  'plugin.removed',
  'comment.added',
  'comment.removed',
  'structure.added',
  'structure.updated',
  'structure.removed',
] as const satisfies readonly EventType[];

export type TypedEvent<K extends EventType = EventType> = {
  [P in K]: DomainEvent<EventPayloads[P]> & { type: P };
}[K];

export function isEventOfType<K extends EventType>(event: DomainEvent, type: K): event is TypedEvent<K> {
  return event.type === type;
}
