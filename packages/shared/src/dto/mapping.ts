import { z } from 'zod';
import { MapRole } from './access.js';
import { StarterAccessRule } from './access-rules.js';
import { BookmarkNumbering, BookmarkTemplate } from './bookmarks.js';
import { EveId, Id, Timestamp } from './common.js';

export const MapScope = z.enum(['wormhole', 'high', 'low', 'null', 'pochven']);
export type MapScope = z.infer<typeof MapScope>;

export const MapSettings = z.object({
  /** Which kinds of space auto-mapping adds. */
  scopes: z.array(MapScope).default(['wormhole']),
  /** Default bookmark label template of the map (see `bookmarks.ts`); absent means `{sig}`. */
  bookmarkTemplate: BookmarkTemplate.optional(),
  /** How `{n}` numbers wormholes (see `bookmarks.ts`); absent means found order, gaps kept. */
  bookmarkNumbering: BookmarkNumbering.optional(),
  /**
   * Wanderer's "only tracked characters": nobody opens the map until every character of theirs
   * that may be tracked here is tracked. Absent: off.
   */
  onlyTrackedCharacters: z.boolean().optional(),
  /** Wanderer's `restrict_offline_showing`: offline characters are shown to managers and up only. */
  offlineForManagersOnly: z.boolean().optional(),
});
export type MapSettings = z.infer<typeof MapSettings>;

export const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb');

export const LabelDto = z.object({
  id: Id,
  name: z.string().trim().min(1).max(32),
  color: Color,
  description: z.string().max(500).default(''),
});
export type LabelDto = z.infer<typeof LabelDto>;

export const Slug = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, digits and dashes');

/**
 * `standard`: a map of its own systems (it may merge shared maps too); `composite`: a map with no
 * objects of its own that merges other maps (an alliance chain). Absent means `standard`.
 */
export const MapKind = z.enum(['standard', 'composite']);
export type MapKind = z.infer<typeof MapKind>;

export const MapDto = z.object({
  id: Id,
  slug: Slug,
  name: z.string(),
  kind: MapKind.optional(),
  ownerAccountId: Id,
  settings: MapSettings,
  labels: z.array(LabelDto),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  /** Shown on the maps page under the name. Optional: maps from before it existed lack it. */
  description: z.string().max(500).optional(),
  /** Set while the map is deleted but can still be restored (instance admins only see it then). */
  deletedAt: Timestamp.nullable().optional(),
});
export type MapDto = z.infer<typeof MapDto>;

/** GET /api/maps item: a map plus the caller's effective role. */
export const MapSummaryDto = MapDto.pick({
  id: true,
  slug: true,
  name: true,
  kind: true,
  description: true,
}).extend({
  role: MapRole.exclude(['blocked']),
});
export type MapSummaryDto = z.infer<typeof MapSummaryDto>;

export const CreateMapRequest = z.object({
  name: z.string().trim().min(1).max(64),
  slug: Slug.optional(),
  kind: MapKind.optional(),
  description: z.string().trim().max(500).optional(),
  /** A first access rule for the creator's own corporation or alliance. */
  starterRule: StarterAccessRule.optional(),
});
export type CreateMapRequest = z.infer<typeof CreateMapRequest>;

export const UpdateMapRequest = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  slug: Slug.optional(),
  description: z.string().trim().max(500).optional(),
  settings: MapSettings.partial().optional(),
});
export type UpdateMapRequest = z.infer<typeof UpdateMapRequest>;

/** PUT /api/maps/:mapId/labels replaces the whole list (manager+). */
export const SetLabelsRequest = z.object({ labels: z.array(LabelDto).max(64) });
export type SetLabelsRequest = z.infer<typeof SetLabelsRequest>;

/**
 * Where a merged object comes from: the maps holding it and whose write is newest. Only on maps that
 * merge others; names come from `MapSnapshot.sources`.
 */
export const ProvenanceDto = z.object({
  /** Source ids (`MapSourceDto.id`) holding the object, in source order. */
  sources: z.array(Id),
  /** The source whose change is the newest, and when it was made. */
  updatedBy: Id,
  updatedAt: Timestamp,
  /** True when a read-write source (or the map itself) holds it, so its editors may change it. */
  writable: z.boolean(),
});
export type ProvenanceDto = z.infer<typeof ProvenanceDto>;

export const Position = z.object({ x: z.number().finite(), y: z.number().finite() });
export type Position = z.infer<typeof Position>;

export const SystemStatus = z.enum([
  'unknown',
  'home',
  'friendly',
  'empty',
  'occupied',
  'warning',
  'hostile',
  'target',
]);
export type SystemStatus = z.infer<typeof SystemStatus>;

/** A solar system placed on a map. Identified by (mapId, solarSystemId). */
export const MapSystemDto = z.object({
  mapId: Id,
  solarSystemId: EveId,
  position: Position,
  customName: z.string().nullable(),
  temporaryName: z.string().nullable(),
  tag: z.string().nullable(),
  status: SystemStatus,
  /** Markdown. */
  description: z.string(),
  labelIds: z.array(Id),
  locked: z.boolean(),
  /** Hidden systems keep their intel; nothing routes to them. */
  visible: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  /** On maps that merge other maps only. */
  provenance: ProvenanceDto.optional(),
});
export type MapSystemDto = z.infer<typeof MapSystemDto>;

export const AddSystemRequest = z.object({ solarSystemId: EveId, position: Position.optional() });
export type AddSystemRequest = z.infer<typeof AddSystemRequest>;

export const UpdateSystemRequest = z
  .object({
    position: Position,
    customName: z.string().trim().max(64).nullable(),
    temporaryName: z.string().trim().max(64).nullable(),
    tag: z.string().trim().max(16).nullable(),
    status: SystemStatus,
    description: z.string().max(10_000),
    labelIds: z.array(Id).max(16),
    locked: z.boolean(),
    visible: z.boolean(),
  })
  .partial();
export type UpdateSystemRequest = z.infer<typeof UpdateSystemRequest>;

/** POST /api/maps/:mapId/systems/positions: batch move after a drag. */
export const MoveSystemsRequest = z.object({
  positions: z
    .array(z.object({ solarSystemId: EveId, x: z.number().finite(), y: z.number().finite() }))
    .min(1),
});
export type MoveSystemsRequest = z.infer<typeof MoveSystemsRequest>;

export const ConnectionType = z.enum(['wormhole', 'gate', 'bridge']);
export type ConnectionType = z.infer<typeof ConnectionType>;
/** `eol`: less than 4 hours of life left. */
export const TimeStatus = z.enum(['normal', 'eol']);
export type TimeStatus = z.infer<typeof TimeStatus>;
/** In-game: fresh > 50 %, reduced 10-50 %, critical < 10 % of mass left. */
export const MassStatus = z.enum(['fresh', 'reduced', 'critical']);
export type MassStatus = z.infer<typeof MassStatus>;
/**
 * Largest ship class that fits, from the max jump mass: small = frigates and destroyers (5 000 t),
 * medium = up to battlecruisers and industrials (62 000 t), large = battleships (375 000-410 000 t),
 * xlarge = freighters (1 000 000 t), capital = capitals (2 000 000 t).
 */
export const ShipSize = z.enum(['small', 'medium', 'large', 'xlarge', 'capital']);
export type ShipSize = z.infer<typeof ShipSize>;
export const Bubbled = z.enum(['none', 'source', 'target', 'both']);
export type Bubbled = z.infer<typeof Bubbled>;

export const ConnectionDto = z.object({
  id: Id,
  mapId: Id,
  source: EveId,
  target: EveId,
  type: ConnectionType,
  timeStatus: TimeStatus,
  massStatus: MassStatus,
  shipSize: ShipSize,
  massSaved: z.boolean(),
  dangerous: z.boolean(),
  bubbled: Bubbled,
  /** When the connection was marked EOL, null otherwise. */
  eolAt: Timestamp.nullable(),
  /**
   * When the mass status was last set, null while it was never changed. Mass estimates count
   * passages from then on. Optional: connections from before it existed lack it.
   */
  massStatusAt: Timestamp.nullable().optional(),
  /**
   * `{n}` of a wormhole: its number among the wormholes out of `bookmarkParent`, the system it is
   * reached from in the chain. Kept by the server, the same for everyone; null for stargates and
   * bridges. Optional: connections from before numbering lack it.
   */
  bookmarkNumber: z.number().int().positive().nullable().optional(),
  bookmarkParent: EveId.nullable().optional(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  /** On maps that merge other maps only. */
  provenance: ProvenanceDto.optional(),
});
export type ConnectionDto = z.infer<typeof ConnectionDto>;

export const AddConnectionRequest = z.object({
  source: EveId,
  target: EveId,
  type: ConnectionType.optional(),
});
export type AddConnectionRequest = z.infer<typeof AddConnectionRequest>;

export const UpdateConnectionRequest = ConnectionDto.pick({
  type: true,
  timeStatus: true,
  massStatus: true,
  shipSize: true,
  massSaved: true,
  dangerous: true,
  bubbled: true,
}).partial();
export type UpdateConnectionRequest = z.infer<typeof UpdateConnectionRequest>;

export const SignatureGroup = z.enum(['unknown', 'wormhole', 'combat', 'relic', 'data', 'gas', 'ore']);
export type SignatureGroup = z.infer<typeof SignatureGroup>;

/** In-game signature id such as `ABC-123`. */
export const SignatureEveId = z.string().regex(/^[A-Z]{3}-\d{3}$/, 'expected ABC-123');

export const SignatureDto = z.object({
  id: Id,
  mapId: Id,
  solarSystemId: EveId,
  eveId: SignatureEveId,
  group: SignatureGroup,
  /** Wormhole type code (e.g. `B274`) or site type. */
  type: z.string().nullable(),
  name: z.string().nullable(),
  description: z.string(),
  connectionId: Id.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  /** On maps that merge other maps only. */
  provenance: ProvenanceDto.optional(),
});
export type SignatureDto = z.infer<typeof SignatureDto>;

export const AddSignatureRequest = z.object({
  eveId: SignatureEveId,
  group: SignatureGroup.optional(),
  type: z.string().trim().max(64).nullable().optional(),
  name: z.string().trim().max(128).nullable().optional(),
  description: z.string().max(2000).optional(),
});
export type AddSignatureRequest = z.infer<typeof AddSignatureRequest>;

export const UpdateSignatureRequest = z
  .object({
    eveId: SignatureEveId,
    group: SignatureGroup,
    type: z.string().trim().max(64).nullable(),
    name: z.string().trim().max(128).nullable(),
    description: z.string().max(2000),
    connectionId: Id.nullable(),
  })
  .partial();
export type UpdateSignatureRequest = z.infer<typeof UpdateSignatureRequest>;

/** Paste from the in-game probe scanner. `replace` also removes signatures missing from the paste. */
export const PasteSignaturesRequest = z.object({
  text: z.string().max(100_000),
  mode: z.enum(['merge', 'replace']).default('merge'),
});
export type PasteSignaturesRequest = z.infer<typeof PasteSignaturesRequest>;

export const PasteSignaturesResult = z.object({
  added: z.number().int(),
  updated: z.number().int(),
  removed: z.number().int(),
  /** Lines the parser did not understand. */
  skipped: z.array(z.string()),
});
export type PasteSignaturesResult = z.infer<typeof PasteSignaturesResult>;
