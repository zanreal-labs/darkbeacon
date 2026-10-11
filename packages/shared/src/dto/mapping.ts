import { z } from 'zod';
import { MapRole } from './access.js';
import { EveId, Id, Timestamp } from './common.js';

export const MapScope = z.enum(['wormhole', 'high', 'low', 'null', 'pochven']);
export type MapScope = z.infer<typeof MapScope>;

export const MapSettings = z.object({
  /** Which kinds of space auto-mapping adds. */
  scopes: z.array(MapScope).default(['wormhole']),
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

export const MapDto = z.object({
  id: Id,
  slug: Slug,
  name: z.string(),
  ownerAccountId: Id,
  settings: MapSettings,
  labels: z.array(LabelDto),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type MapDto = z.infer<typeof MapDto>;

/** GET /api/maps item: a map plus the caller's effective role. */
export const MapSummaryDto = MapDto.pick({ id: true, slug: true, name: true }).extend({
  role: MapRole.exclude(['blocked']),
});
export type MapSummaryDto = z.infer<typeof MapSummaryDto>;

export const CreateMapRequest = z.object({
  name: z.string().trim().min(1).max(64),
  slug: Slug.optional(),
});
export type CreateMapRequest = z.infer<typeof CreateMapRequest>;

export const UpdateMapRequest = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  slug: Slug.optional(),
  settings: MapSettings.partial().optional(),
});
export type UpdateMapRequest = z.infer<typeof UpdateMapRequest>;

/** PUT /api/maps/:mapId/labels replaces the whole list (manager+). */
export const SetLabelsRequest = z.object({ labels: z.array(LabelDto).max(64) });
export type SetLabelsRequest = z.infer<typeof SetLabelsRequest>;

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
/** Largest ship class that fits: small = frigates, medium = up to battlecruisers, large = battleships, xlarge = capitals/freighters. */
export const ShipSize = z.enum(['small', 'medium', 'large', 'xlarge']);
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
  createdAt: Timestamp,
  updatedAt: Timestamp,
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
