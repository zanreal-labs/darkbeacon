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
  /**
   * Who may copy systems off this map and paste systems onto it (the lowest role). Absent: viewers
   * copy, members paste.
   */
  clipboard: z.object({ copy: MapRole, paste: MapRole }).optional(),
});
export type MapSettings = z.infer<typeof MapSettings>;

export const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb');

/**
 * A **Tag** of the map (Staging, Sites, Hostile, Exit): a named, coloured marker with a description,
 * set on systems through `MapSystemDto.labelIds`. Called "labels" in the data for history's sake;
 * everything users see says Tags (see docs/decisions.md).
 */
export const LabelDto = z.object({
  id: Id,
  name: z.string().trim().min(1).max(32),
  color: Color,
  description: z.string().max(500).default(''),
});
export type LabelDto = z.infer<typeof LabelDto>;

/**
 * A **Label** of the map (WH1, WH2, A, B...): a short neutral text marker, as in Wanderer, set on
 * systems through `MapSystemDto.systemLabelIds`. Managers keep the list; the description says what
 * a short name stands for.
 */
export const SystemLabelDto = z.object({
  id: Id,
  name: z.string().trim().min(1).max(8),
  description: z.string().trim().max(120).default(''),
});
export type SystemLabelDto = z.infer<typeof SystemLabelDto>;

/** The Labels every new map starts with. Ids are only unique within a map, so they can be fixed. */
export const DEFAULT_SYSTEM_LABELS: readonly SystemLabelDto[] = [
  { id: 'wh1', name: 'WH1', description: '' },
  { id: 'wh2', name: 'WH2', description: '' },
  { id: 'wh3', name: 'WH3', description: '' },
];

/** Longest custom label of a system: a word, like "bait" or "scout". */
export const CUSTOM_LABEL_MAX = 16;

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

/** Longest map description. */
export const MAP_DESCRIPTION_MAX = 1000;
const MapDescription = z.string().trim().max(MAP_DESCRIPTION_MAX);

export const MapDto = z.object({
  id: Id,
  slug: Slug,
  name: z.string(),
  /** What the map is for, shown in the list of maps; absent when empty. */
  description: z.string().optional(),
  kind: MapKind.optional(),
  ownerAccountId: Id,
  settings: MapSettings,
  /** The map's Tags. */
  labels: z.array(LabelDto),
  /** The map's Labels (WH1, WH2...). */
  systemLabels: z.array(SystemLabelDto),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  /** Set while the map is deleted but can still be restored (instance admins only see it then). */
  deletedAt: Timestamp.nullable().optional(),
});
export type MapDto = z.infer<typeof MapDto>;

/** GET /api/maps item: a map plus the caller's effective role. */
export const MapSummaryDto = MapDto.pick({
  id: true,
  slug: true,
  name: true,
  description: true,
  kind: true,
}).extend({
  role: MapRole.exclude(['blocked']),
});
export type MapSummaryDto = z.infer<typeof MapSummaryDto>;

export const CreateMapRequest = z.object({
  name: z.string().trim().min(1).max(64),
  slug: Slug.optional(),
  kind: MapKind.optional(),
  description: MapDescription.optional(),
  /** A first access rule for the creator's own corporation or alliance. */
  starterRule: StarterAccessRule.optional(),
});
export type CreateMapRequest = z.infer<typeof CreateMapRequest>;

export const UpdateMapRequest = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  slug: Slug.optional(),
  /** An empty string clears it. */
  description: MapDescription.optional(),
  settings: MapSettings.partial().optional(),
});
export type UpdateMapRequest = z.infer<typeof UpdateMapRequest>;

/** PUT /api/maps/:mapId/labels replaces the whole list of Tags (manager+). */
export const SetLabelsRequest = z.object({ labels: z.array(LabelDto).max(64) });
export type SetLabelsRequest = z.infer<typeof SetLabelsRequest>;

/** PUT /api/maps/:mapId/system-labels replaces the whole list of Labels, in order (manager+). */
export const SetSystemLabelsRequest = z.object({ systemLabels: z.array(SystemLabelDto).max(32) });
export type SetSystemLabelsRequest = z.infer<typeof SetSystemLabelsRequest>;

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
  /** Free-text tag of old; kept for compatibility, no longer shown or edited (Tags replace it). */
  tag: z.string().nullable(),
  status: SystemStatus,
  /** Markdown. */
  description: z.string(),
  /** The system's Tags (ids of `MapDto.labels`). */
  labelIds: z.array(Id),
  /** The system's Labels (ids of `MapDto.systemLabels`). */
  systemLabelIds: z.array(Id),
  /** One free-text label of the system ("bait"), shown after its Labels; null for none. */
  customLabel: z.string().nullable(),
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
    systemLabelIds: z.array(Id).max(32),
    customLabel: z.string().trim().max(CUSTOM_LABEL_MAX).nullable(),
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

/**
 * How much life a hole had left when someone looked: "less than N hours". `1h` and `4h` are end of
 * life; `4.5h` is the whole life of small holes; `16h`, `24h` and `48h` are the lifetimes of the
 * longer-lived holes (48 h only for a few C6 statics). The same marks Wanderer offers.
 */
export const LifetimeMark = z.enum(['1h', '4h', '4.5h', '16h', '24h', '48h']);
export type LifetimeMark = z.infer<typeof LifetimeMark>;
export const LIFETIME_MARK_HOURS: Record<LifetimeMark, number> = {
  '1h': 1,
  '4h': 4,
  '4.5h': 4.5,
  '16h': 16,
  '24h': 24,
  '48h': 48,
};

/** When a connection's lifetime was marked and with what: it expires before `at` + the mark's hours. */
export const ConnectionLifetimeDto = z.object({ mark: LifetimeMark, at: Timestamp });
export type ConnectionLifetimeDto = z.infer<typeof ConnectionLifetimeDto>;

/** Longest connection note. */
export const CONNECTION_NOTE_MAX = 2000;

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
  /**
   * Locked connections are changed and removed by managers only, never by auto-mapping. Absent
   * means unlocked.
   */
  locked: z.boolean().optional(),
  /** Free text about the hole (who rolled it, what is behind it). Absent means none. */
  note: z.string().max(CONNECTION_NOTE_MAX).optional(),
  /** The last lifetime mark ("less than 16 h left") and when it was set; absent or null: none. */
  lifetime: ConnectionLifetimeDto.nullable().optional(),
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
})
  .extend({
    /** Managers only. */
    locked: z.boolean(),
    note: z.string().max(CONNECTION_NOTE_MAX),
    /** A new mark is stamped with the time it was set; null clears it. */
    lifetime: LifetimeMark.nullable(),
  })
  .partial();
export type UpdateConnectionRequest = z.infer<typeof UpdateConnectionRequest>;

export const SignatureGroup = z.enum(['unknown', 'wormhole', 'combat', 'relic', 'data', 'gas', 'ore']);
export type SignatureGroup = z.infer<typeof SignatureGroup>;

/** In-game signature id such as `ABC-123`. */
export const SignatureEveId = z.string().regex(/^[A-Z]{3}-\d{3}$/, 'expected ABC-123');

/** The id of a custom entry (one someone wrote, not the scanner's): any short text. */
export const CustomSignatureId = z.string().trim().min(1).max(32);

/** True when `id` is a scanner id (`ABC-123`). */
export function isScannerSignatureId(id: string): boolean {
  return /^[A-Z]{3}-\d{3}$/.test(id);
}

/**
 * What a scan result is: a cosmic signature (probed down), a cosmic anomaly (on the scanner at
 * once) or anything else the scanner lists (ships, structures, deployables, drones).
 */
export const SignatureKind = z.enum(['signature', 'anomaly', 'other']);
export type SignatureKind = z.infer<typeof SignatureKind>;

export const SignatureDto = z.object({
  id: Id,
  mapId: Id,
  solarSystemId: EveId,
  /** `ABC-123`, or any short text for a custom entry. */
  eveId: z.string().min(1).max(32),
  group: SignatureGroup,
  /** Wormhole type code (e.g. `B274`) or site type. */
  type: z.string().nullable(),
  name: z.string().nullable(),
  description: z.string(),
  connectionId: Id.nullable(),
  /** Absent means a cosmic signature. */
  kind: SignatureKind.optional(),
  /** Someone wrote it (its id need not be the scanner's). Absent means false. */
  custom: z.boolean().optional(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  /** On maps that merge other maps only. */
  provenance: ProvenanceDto.optional(),
});
export type SignatureDto = z.infer<typeof SignatureDto>;

export const AddSignatureRequest = z
  .object({
    eveId: CustomSignatureId,
    group: SignatureGroup.optional(),
    type: z.string().trim().max(64).nullable().optional(),
    name: z.string().trim().max(128).nullable().optional(),
    description: z.string().max(2000).optional(),
    kind: SignatureKind.optional(),
    /** A custom entry: its id may be any short text. */
    custom: z.boolean().optional(),
  })
  .refine((r) => r.custom === true || isScannerSignatureId(r.eveId), {
    message: 'expected ABC-123 (or mark the entry as custom)',
    path: ['eveId'],
  });
export type AddSignatureRequest = z.infer<typeof AddSignatureRequest>;

export const UpdateSignatureRequest = z
  .object({
    /** Checked against the entry: scanner entries keep `ABC-123` ids. */
    eveId: CustomSignatureId,
    group: SignatureGroup,
    kind: SignatureKind,
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
