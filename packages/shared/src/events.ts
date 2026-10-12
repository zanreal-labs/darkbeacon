import { z } from 'zod';
import type { DomainEvent } from '@darkbeacon/core';
import type { AccessRuleDto } from './dto/access.js';
import type { InstanceRole } from './dto/identity.js';
import type { PluginDto } from './dto/plugins.js';
import type {
  ConnectionDto,
  LabelDto,
  MapDto,
  MapSystemDto,
  SignatureDto,
  SystemLabelDto,
} from './dto/mapping.js';
import type { MassMode, PassageSource } from './dto/passages.js';
import type { HubDto, MapExitDto } from './dto/routing.js';
import type { CharacterPresenceDto } from './dto/tracking.js';
import type { MapShareDto, MapSourceDto } from './dto/sharing.js';
import type { McpMode } from './dto/publishing.js';
import type { ShareScope } from './share-scope.js';

/** A passage as events carry it. */
export interface PassageEventData {
  connectionId: string;
  characterId: number | null;
  shipTypeId: number | null;
  mass?: number | null;
  from?: number;
  to?: number;
  passageId?: string;
  source?: PassageSource;
  massMode?: MassMode;
  higgs?: boolean;
  entangler?: boolean;
  note?: string | null;
}

export const DomainEventSchema = z.object({
  id: z.string(),
  seq: z.number().int().positive(),
  stream: z.string(),
  type: z.string(),
  occurredAt: z.number().int(),
  actor: z.object({ kind: z.enum(['account', 'apiToken', 'public', 'system', 'plugin']), id: z.string() }),
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
   * A ship went through a connection on the map: a tracked character's jump, or one logged by
   * hand (`source: 'manual'`, `characterId` null). `mass` (kg, null for unknown ships), `from`,
   * `to` and `passageId` were added later, and `source`, `massMode`, `higgs`, `entangler` and
   * `note` after them; all are optional for readers.
   */
  'connection.passage': PassageEventData;
  /** A passage's mass mode (cold, hot, custom), modifiers or note changed. */
  'connection.passage_updated': PassageEventData & { passageId: string };
  /** A passage was deleted (logged by mistake). */
  'connection.passage_removed': { passageId: string; connectionId: string };
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
  /** The map's Tags were replaced (manager+). */
  'labels.changed': { labels: LabelDto[] };
  /** The map's Labels (WH1, WH2...) were replaced (manager+). */
  'system_labels.changed': { systemLabels: SystemLabelDto[] };
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
  /**
   * The map's public link or MCP reach changed (map admins). The link's token is never in the
   * event: map viewers and webhooks see that it changed, not the link itself.
   */
  'access.public_link_changed': {
    mapId: string;
    enabled: boolean;
    slug: string | null;
    scopes: ShareScope[];
    noindex: boolean;
    mcpMode: McpMode;
    /** True when the change made a new link (the old one stopped working). */
    regenerated: boolean;
  };
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
  /** A rule's role changed in place (the audit record holds the role before). */
  'access.rule_changed': AccessRuleDto;
  /** The map was handed to another account (the new owner is admin, the old one keeps only rules). */
  'access.owner_changed': { mapId: string; ownerAccountId: string; previousOwnerAccountId: string };
  /**
   * The map was deleted, but can still be restored by an instance admin: nobody can open it until
   * then. Rules, shares and webhooks stay with it (`map.removed` follows once it is purged).
   */
  'map.trashed': { id: string; deletedAt: number };
  /** An instance admin brought a deleted map back as it was. */
  'map.restored': MapDto;
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
  'connection.passage_updated',
  'connection.passage_removed',
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
  'system_labels.changed',
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
  'access.public_link_changed',
  'access.role_changed',
  'access.account_changed',
  'character.unlinked',
  'plugin.updated',
  'plugin.removed',
  'access.rule_changed',
  'access.owner_changed',
  'map.trashed',
  'map.restored',
] as const satisfies readonly EventType[];

export type TypedEvent<K extends EventType = EventType> = {
  [P in K]: DomainEvent<EventPayloads[P]> & { type: P };
}[K];

export function isEventOfType<K extends EventType>(event: DomainEvent, type: K): event is TypedEvent<K> {
  return event.type === type;
}
