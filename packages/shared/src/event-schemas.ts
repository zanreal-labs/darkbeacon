import { z } from 'zod';
import { AccessRuleDto } from './dto/access.js';
import { EveId, Id, Timestamp } from './dto/common.js';
import { InstanceRole } from './dto/identity.js';
import {
  ConnectionDto,
  LabelDto,
  MapDto,
  MapSystemDto,
  SignatureDto,
  SystemLabelDto,
} from './dto/mapping.js';
import { MassMode, PassageSource } from './dto/passages.js';
import { PluginDto } from './dto/plugins.js';
import { HubDto, MapExitDto } from './dto/routing.js';
import { McpMode } from './dto/publishing.js';
import { MapShareDto, MapSourceDto } from './dto/sharing.js';
import { CharacterPresenceDto } from './dto/tracking.js';
import type { EventType } from './events.js';
import { shareScope } from './share-scope.js';

/** A passage as events carry it (`PassageEventData`); manual passages have no character. */
const PassageEventSchema = z.object({
  connectionId: Id,
  characterId: EveId.nullable(),
  shipTypeId: EveId.nullable(),
  mass: z.number().nullable().optional(),
  from: EveId.optional(),
  to: EveId.optional(),
  passageId: Id.optional(),
  source: PassageSource.optional(),
  massMode: MassMode.optional(),
  higgs: z.boolean().optional(),
  entangler: z.boolean().optional(),
  note: z.string().nullable().optional(),
});

/**
 * `data` of every event type, as schemas for the API description (webhooks, the WebSocket
 * protocol). The types in `EventPayloads` are what the code compiles against; this table must
 * describe the same shapes (it is a `Record` over every type, and the docs test checks that each
 * schema accepts the samples the audit catalogue test uses).
 */
export const EVENT_DATA_SCHEMAS: Record<EventType, z.ZodType> = {
  'system.added': MapSystemDto,
  'system.updated': MapSystemDto,
  'system.removed': z.object({ solarSystemId: EveId }),
  'connection.added': ConnectionDto,
  'connection.updated': ConnectionDto,
  'connection.removed': z.object({ id: Id }),
  'connection.passage': PassageEventSchema,
  'connection.passage_updated': PassageEventSchema.extend({ passageId: Id }),
  'connection.passage_removed': z.object({ passageId: Id, connectionId: Id }),
  'signature.added': SignatureDto,
  'signature.updated': SignatureDto,
  'signature.removed': z.object({ id: Id, solarSystemId: EveId }),
  'character.moved': z.object({ characterId: EveId, from: EveId.nullable(), to: EveId.nullable() }),
  'character.jumped': z.object({ characterId: EveId, from: EveId, to: EveId, shipTypeId: EveId.nullable() }),
  'character.ship_changed': z.object({
    characterId: EveId,
    shipTypeId: EveId,
    shipName: z.string().nullable(),
  }),
  'character.online_changed': z.object({ characterId: EveId, online: z.boolean() }),
  'character.tracked': CharacterPresenceDto,
  'character.untracked': z.object({ characterId: EveId }),
  'map.settings_changed': MapDto,
  'map.created': MapDto,
  'map.removed': z.object({ id: Id }),
  'labels.changed': z.object({ labels: z.array(LabelDto) }),
  'system_labels.changed': z.object({ systemLabels: z.array(SystemLabelDto) }),
  'map.share.offered': MapShareDto,
  'map.share.accepted': MapShareDto,
  'map.share.changed': MapShareDto,
  'map.share.revoked': MapShareDto,
  'map.sources_changed': z.object({ sources: z.array(MapSourceDto) }),
  'routes.exits_changed': z.object({ exits: z.array(MapExitDto) }),
  'routes.hubs_changed': z.object({ hubs: z.array(HubDto) }),
  'ping.created': z.object({
    id: Id,
    solarSystemId: EveId,
    message: z.string(),
    createdBy: z.string(),
    createdAt: Timestamp,
  }),
  'ping.removed': z.object({ id: Id }),
  'access.rule_added': AccessRuleDto,
  'access.rule_removed': z.object({ id: Id }),
  'access.public_link_changed': z.object({
    mapId: Id,
    enabled: z.boolean(),
    slug: z.string().nullable(),
    scopes: z.array(shareScope),
    noindex: z.boolean(),
    mcpMode: McpMode,
    regenerated: z.boolean(),
  }),
  'access.role_changed': z.object({ accountId: Id, role: InstanceRole }),
  'access.account_changed': z.object({ accountId: Id }),
  'character.unlinked': z.object({ characterId: EveId }),
  'plugin.updated': PluginDto,
  'plugin.removed': z.object({ id: z.string() }),
  'access.rule_changed': AccessRuleDto,
  'access.owner_changed': z.object({ mapId: Id, ownerAccountId: Id, previousOwnerAccountId: Id }),
  'map.trashed': z.object({ id: Id, deletedAt: Timestamp }),
  'map.restored': MapDto,
};
