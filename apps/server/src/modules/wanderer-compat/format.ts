import { createHash } from 'node:crypto';
import type { DomainEvent } from '@darkbeacon/core';
import type {
  AccessRuleDto,
  CharacterPresenceDto,
  ConnectionDto,
  MapSystemDto,
  SignatureDto,
  SystemLabelDto,
  SystemStatus,
} from '@darkbeacon/shared';

/*
 * Darkbeacon objects and events in the shapes of Wanderer's legacy map API (`/api/map/*`, the
 * `/api/maps/:map_identifier/events/stream` SSE stream), as Wanderer v1.103 writes them in code
 * (`APIUtils.map_system_to_json`, `connection_to_json`, `ExternalEvents.Event.to_json`). Bots
 * written for Wanderer read these; nothing here is Darkbeacon's own API.
 */

/** Wanderer's system status integers, as its map UI writes them. */
const STATUS: Record<SystemStatus, number> = {
  unknown: 0,
  home: 1,
  friendly: 2,
  empty: 0,
  occupied: 4,
  warning: 4,
  target: 5,
  hostile: 6,
};

const MASS = { fresh: 0, reduced: 1, critical: 2 } as const;
const TIME = { normal: 0, eol: 1 } as const;
const SIZE = { small: 0, medium: 1, large: 2, xlarge: 3, capital: 4 } as const;
const TYPE = { wormhole: 0, gate: 1, bridge: 2 } as const;
const GROUP: Record<string, string> = {
  wormhole: 'Wormhole',
  combat: 'Combat Site',
  relic: 'Relic Site',
  data: 'Data Site',
  gas: 'Gas Site',
  ore: 'Ore Site',
  unknown: '',
};

/** Every event name a Wanderer SSE client may ask for (`events=`); others are dropped. */
export const WANDERER_EVENT_TYPES = [
  'add_system',
  'deleted_system',
  'system_renamed',
  'system_metadata_changed',
  'connection_added',
  'connection_removed',
  'connection_updated',
  'character_added',
  'character_removed',
  'character_updated',
  'character_location_changed',
  'character_online_status_changed',
  'character_ship_changed',
  'character_ready_status_changed',
  'signature_added',
  'signature_removed',
  'signatures_updated',
  'map_kill',
  'acl_member_added',
  'acl_member_removed',
  'acl_member_updated',
  'rally_point_added',
  'rally_point_removed',
] as const;

/** Wanderer's timestamps: ISO 8601 UTC with microseconds. */
export function wandererTime(ms: number): string {
  return new Date(ms).toISOString().replace(/Z$/, '000Z');
}

/** A stable UUID for things that have none of their own here (map systems, characters). */
export function stableUuid(...parts: Array<string | number>): string {
  const hex = createHash('sha256').update(parts.join(':')).digest('hex');
  // Version 5 layout (name-based); only the shape matters to clients.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${(
    (parseInt(hex.slice(16, 18), 16) & 0x3f) |
    0x80
  )
    .toString(16)
    .padStart(2, '0')}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * The ULID of a Darkbeacon id: a UUID v7 and a ULID are both 128 bits that start with the time in
 * milliseconds, so the same bits in Crockford base32 sort the same way. Wanderer clients send the
 * last one back as `last_event_id`.
 */
export function ulidOf(uuid: string): string {
  let value = BigInt(`0x${uuid.replace(/-/g, '')}`);
  let out = '';
  for (let i = 0; i < 26; i++) {
    out = CROCKFORD[Number(value & 31n)]! + out;
    value >>= 5n;
  }
  return out;
}

export const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * The labels column as Wanderer's map UI stores it: JSON of the custom label and the Labels (WH1,
 * A, B...); Darkbeacon's Labels are Wanderer's, with their names instead of its codes.
 */
function labelsOf(system: MapSystemDto, labels: ReadonlyMap<string, SystemLabelDto>): string | null {
  const ids = system.systemLabelIds ?? [];
  const custom = system.customLabel ?? '';
  if (ids.length === 0 && !custom) return null;
  const names = ids.map((id) => labels.get(id)?.name).filter((n): n is string => !!n);
  return JSON.stringify({ customLabel: custom, labels: names });
}

export interface FormatContext {
  mapId: string;
  /** Static name of a solar system (`J123456`); null when unknown. */
  systemName(solarSystemId: number): string | null;
  /** The map's Labels (`MapDto.systemLabels`). */
  labels: ReadonlyMap<string, SystemLabelDto>;
}

export function wandererSystem(system: MapSystemDto, ctx: FormatContext) {
  const original = ctx.systemName(system.solarSystemId) ?? `System ${system.solarSystemId}`;
  return {
    id: stableUuid('system', ctx.mapId, system.solarSystemId),
    map_id: ctx.mapId,
    solar_system_id: system.solarSystemId,
    name: system.temporaryName || system.customName || original,
    original_name: original,
    custom_name: system.customName,
    temporary_name: system.temporaryName,
    description: system.description || null,
    tag: system.tag,
    labels: labelsOf(system, ctx.labels),
    locked: system.locked,
    visible: system.visible,
    status: STATUS[system.status] ?? 0,
    position_x: Math.round(system.position.x),
    position_y: Math.round(system.position.y),
    inserted_at: wandererTime(system.createdAt),
    updated_at: wandererTime(system.updatedAt),
  };
}

/** The wormhole type of a connection, from a typed signature on it that is not the K162 side. */
export function wormholeTypeOf(
  connection: ConnectionDto,
  signatures: readonly SignatureDto[],
): string | null {
  const types = signatures
    .filter((s) => s.connectionId === connection.id && s.type)
    .map((s) => s.type!.toUpperCase());
  return types.find((t) => t !== 'K162') ?? types[0] ?? null;
}

export function wandererConnection(connection: ConnectionDto, mapId: string, wormholeType: string | null) {
  return {
    id: connection.id,
    map_id: mapId,
    solar_system_source: connection.source,
    solar_system_target: connection.target,
    mass_status: MASS[connection.massStatus],
    time_status: TIME[connection.timeStatus],
    ship_size_type: SIZE[connection.shipSize],
    type: TYPE[connection.type],
    wormhole_type: wormholeType,
    locked: false,
    inserted_at: wandererTime(connection.createdAt),
    updated_at: wandererTime(connection.updatedAt),
  };
}

/** A character as Wanderer's map UI stats show it. */
export interface WandererCharacterFacts {
  name: string;
  corporationId: number | null;
  corporationTicker: string | null;
  allianceId: number | null;
  allianceTicker: string | null;
}

export function wandererCharacter(characterId: number, facts: WandererCharacterFacts) {
  return {
    eve_id: String(characterId),
    name: facts.name,
    corporation_id: facts.corporationId,
    corporation_ticker: facts.corporationTicker,
    alliance_id: facts.allianceId,
    alliance_ticker: facts.allianceTicker,
  };
}

export function wandererTrackedCharacter(
  presence: CharacterPresenceDto,
  mapId: string,
  facts: WandererCharacterFacts,
) {
  return {
    id: stableUuid('tracking', mapId, presence.characterId),
    map_id: mapId,
    character_id: stableUuid('character', presence.characterId),
    tracked: true,
    followed: false,
    inserted_at: wandererTime(presence.updatedAt),
    updated_at: wandererTime(presence.updatedAt),
    character: wandererCharacter(presence.characterId, facts),
  };
}

/**
 * What a Wanderer stream needs to remember to describe removals (Darkbeacon's removal events name
 * only the id): connections' systems, signatures' codes, characters' names.
 */
export class WandererStreamState {
  readonly connections = new Map<string, { source: number; target: number }>();
  readonly signatures = new Map<string, { solarSystemId: number; eveId: string }>();
  readonly characters = new Map<number, string>();

  constructor(snapshot: {
    connections?: readonly ConnectionDto[];
    signatures?: readonly SignatureDto[];
    characters?: readonly CharacterPresenceDto[];
  }) {
    for (const c of snapshot.connections ?? [])
      this.connections.set(c.id, { source: c.source, target: c.target });
    for (const s of snapshot.signatures ?? [])
      this.signatures.set(s.id, { solarSystemId: s.solarSystemId, eveId: s.eveId });
    for (const c of snapshot.characters ?? []) this.characters.set(c.characterId, c.name);
  }
}

export interface WandererEnvelope {
  id: string;
  type: (typeof WANDERER_EVENT_TYPES)[number];
  map_id: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

/**
 * A Darkbeacon map event as Wanderer's external event (null: Wanderer has no such event). Keeps
 * `state` current, so later removals can still be described.
 */
export function wandererEvent(
  event: DomainEvent,
  ctx: FormatContext,
  state: WandererStreamState,
): WandererEnvelope | null {
  const envelope = (type: WandererEnvelope['type'], payload: Record<string, unknown>): WandererEnvelope => ({
    id: ulidOf(event.id),
    type,
    map_id: ctx.mapId,
    timestamp: wandererTime(event.occurredAt),
    payload,
  });
  const data = event.data as Record<string, unknown>;
  switch (event.type) {
    case 'system.added': {
      const s = data as unknown as MapSystemDto;
      return envelope('add_system', {
        solar_system_id: s.solarSystemId,
        name: wandererSystem(s, ctx).name,
        position_x: Math.round(s.position.x),
        position_y: Math.round(s.position.y),
      });
    }
    case 'system.removed':
      return envelope('deleted_system', {
        solar_system_id: data.solarSystemId,
        name: null,
        position_x: null,
        position_y: null,
      });
    case 'system.updated': {
      const s = wandererSystem(data as unknown as MapSystemDto, ctx);
      return envelope('system_metadata_changed', {
        system_id: s.id,
        solar_system_id: s.solar_system_id,
        name: s.name,
        temporary_name: s.temporary_name,
        labels: s.labels,
        description: s.description,
        status: s.status,
        locked: s.locked,
        position_x: s.position_x,
        position_y: s.position_y,
      });
    }
    case 'connection.added':
    case 'connection.updated': {
      const c = data as unknown as ConnectionDto;
      state.connections.set(c.id, { source: c.source, target: c.target });
      const payload = {
        connection_id: c.id,
        solar_system_source_id: c.source,
        solar_system_target_id: c.target,
        type: TYPE[c.type],
        ship_size_type: SIZE[c.shipSize],
        mass_status: MASS[c.massStatus],
        time_status: TIME[c.timeStatus],
      };
      return event.type === 'connection.added'
        ? envelope('connection_added', payload)
        : envelope('connection_updated', { ...payload, locked: false, custom_info: null });
    }
    case 'connection.removed': {
      const id = String(data.id);
      const known = state.connections.get(id);
      state.connections.delete(id);
      return envelope('connection_removed', {
        connection_id: id,
        solar_system_source_id: known?.source ?? null,
        solar_system_target_id: known?.target ?? null,
      });
    }
    case 'signature.added': {
      const s = data as unknown as SignatureDto;
      state.signatures.set(s.id, { solarSystemId: s.solarSystemId, eveId: s.eveId });
      return envelope('signature_added', {
        solar_system_id: s.solarSystemId,
        signature_id: s.eveId,
        name: s.name,
        kind: 'Cosmic Signature',
        group: GROUP[s.group] ?? '',
        type: s.type,
      });
    }
    case 'signature.updated': {
      const s = data as unknown as SignatureDto;
      state.signatures.set(s.id, { solarSystemId: s.solarSystemId, eveId: s.eveId });
      return null;
    }
    case 'signature.removed': {
      const id = String(data.id);
      const known = state.signatures.get(id);
      state.signatures.delete(id);
      return envelope('signature_removed', {
        solar_system_id: data.solarSystemId,
        signature_id: known?.eveId ?? null,
      });
    }
    case 'character.tracked': {
      const c = data as unknown as CharacterPresenceDto;
      state.characters.set(c.characterId, c.name);
      return envelope('character_added', {
        id: stableUuid('character', c.characterId),
        name: c.name,
        eve_id: String(c.characterId),
      });
    }
    case 'character.untracked': {
      const characterId = Number(data.characterId);
      const name = state.characters.get(characterId) ?? null;
      state.characters.delete(characterId);
      return envelope('character_removed', {
        id: stableUuid('character', characterId),
        name,
        eve_id: String(characterId),
      });
    }
    case 'access.rule_added':
    case 'access.rule_removed':
    case 'access.rule_changed': {
      const rule = data as unknown as Partial<AccessRuleDto>;
      // A removal names only the rule: Wanderer's member fields stay empty then.
      const kind = rule.subjectKind;
      if (kind && !['character', 'corporation', 'alliance'].includes(kind)) return null;
      const type =
        event.type === 'access.rule_added'
          ? 'acl_member_added'
          : event.type === 'access.rule_removed'
            ? 'acl_member_removed'
            : 'acl_member_updated';
      return envelope(type, {
        acl_id: ctx.mapId,
        member_id: rule.id ?? null,
        member_name: rule.subject?.name ?? null,
        member_type: kind ?? null,
        eve_id: rule.subjectId ?? null,
        role: rule.role ?? null,
      });
    }
    case 'ping.created':
      return envelope('rally_point_added', {
        rally_point_id: data.id,
        solar_system_id: data.solarSystemId,
        system_name: ctx.systemName(Number(data.solarSystemId)),
        message: data.message,
        created_at: typeof data.createdAt === 'number' ? wandererTime(data.createdAt) : null,
      });
    case 'ping.removed':
      return envelope('rally_point_removed', { id: data.id });
    default:
      return null;
  }
}

/** One frame of Wanderer's stream: `event:`, `id:`, `data:` and a blank line. */
export function wandererFrame(envelope: { type: string; id: string }, data: unknown = envelope): string {
  return `event: ${envelope.type}\nid: ${envelope.id}\ndata: ${JSON.stringify(data)}\n\n`;
}
