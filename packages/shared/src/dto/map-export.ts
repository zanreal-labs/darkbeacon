import { z } from 'zod';
import { AccessSubjectKind, MapRole } from './access.js';
import { CommentDto } from './comments.js';
import { EveId, Id, Timestamp } from './common.js';
import {
  ConnectionDto,
  LabelDto,
  MapKind,
  MapSettings,
  MapSystemDto,
  SignatureDto,
  Slug,
  SystemLabelDto,
} from './mapping.js';
import { StructureDto } from './structures.js';
import { MapViewDto, MAP_VIEWS_MAX } from './views.js';

/**
 * Darkbeacon's own map file: everything on a map (hidden systems with the intel they keep, every
 * connection, signature, structure and comment), its settings and labels, and on request its access rules. It is
 * the way back out of Darkbeacon and the way between instances. Versioned: readers refuse a
 * format or version they do not know; a new version adds a reader, old files keep working.
 */
export const MAP_EXPORT_FORMAT = 'darkbeacon.map';
export const MAP_EXPORT_VERSION = 1;

export const ExportedSystem = MapSystemDto.omit({ mapId: true, provenance: true });
export type ExportedSystem = z.infer<typeof ExportedSystem>;

/** `id` is the connection's id in the file, for signatures to point at; a new map gets new ids. */
export const ExportedConnection = ConnectionDto.omit({ mapId: true, provenance: true });
export type ExportedConnection = z.infer<typeof ExportedConnection>;

export const ExportedSignature = SignatureDto.omit({ mapId: true, provenance: true });
export type ExportedSignature = z.infer<typeof ExportedSignature>;

/** Authors and dates stay as they were written; a new map gets new ids. */
export const ExportedStructure = StructureDto.omit({ mapId: true });
export type ExportedStructure = z.infer<typeof ExportedStructure>;

export const ExportedComment = CommentDto.omit({ mapId: true });
export type ExportedComment = z.infer<typeof ExportedComment>;

export const ExportedAccessRule = z.object({
  subjectKind: AccessSubjectKind,
  subjectId: z.string().min(1),
  guildId: z.string().nullable(),
  role: MapRole,
});
export type ExportedAccessRule = z.infer<typeof ExportedAccessRule>;

export const MapExportDocument = z.object({
  format: z.literal(MAP_EXPORT_FORMAT),
  version: z.literal(MAP_EXPORT_VERSION),
  exportedAt: Timestamp,
  /** Where it came from (the instance's public address, when known). */
  source: z.object({ instance: z.string().nullable(), mapId: Id, slug: Slug }),
  map: z.object({
    name: z.string().min(1).max(64),
    slug: Slug,
    description: z.string().max(500),
    kind: MapKind.optional(),
    settings: MapSettings,
    labels: z.array(LabelDto).max(64),
    /** The map's Labels (WH1, A, B...); Tags are `labels`. */
    systemLabels: z.array(SystemLabelDto).max(32).default([]),
    /** The map's published views; absent in files written before maps had them. */
    views: z.array(MapViewDto).max(MAP_VIEWS_MAX).optional(),
  }),
  systems: z.array(ExportedSystem).max(10_000),
  connections: z.array(ExportedConnection).max(20_000),
  signatures: z.array(ExportedSignature).max(100_000),
  /** Absent in files written before maps carried structures and comments. */
  structures: z.array(ExportedStructure).max(20_000).optional(),
  comments: z.array(ExportedComment).max(100_000).optional(),
  /** Only when the exporting person administers the map and asked for them. */
  accessRules: z.array(ExportedAccessRule).max(5_000).optional(),
});
export type MapExportDocument = z.infer<typeof MapExportDocument>;

/** GET /api/maps/:mapId/export */
export const MapExportQuery = z.object({
  /** Include the access rules (map admins). */
  accessRules: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type MapExportQuery = z.infer<typeof MapExportQuery>;

/** POST /api/maps/import: a new map from a file, owned by the caller. */
export const ImportMapRequest = z.object({
  document: MapExportDocument,
  /** Defaults to the name in the file. */
  name: z.string().trim().min(1).max(64).optional(),
  /** Defaults to the slug in the file, or a free one next to it when taken. */
  slug: Slug.optional(),
  /** Bring the access rules of the file along (default yes, when it has any). */
  accessRules: z.boolean().default(true),
});
export type ImportMapRequest = z.infer<typeof ImportMapRequest>;

export const ImportMapResultDto = z.object({
  map: z.object({ id: Id, slug: Slug, name: z.string() }),
  systems: z.number().int(),
  connections: z.number().int(),
  signatures: z.number().int(),
  accessRules: z.number().int(),
  /** Systems of the file this instance's universe does not know; left out. */
  skippedSystems: z.array(EveId),
});
export type ImportMapResultDto = z.infer<typeof ImportMapResultDto>;

/** The settings of a map alone, to carry them to another map (Wanderer's settings export). */
export const MAP_SETTINGS_EXPORT_FORMAT = 'darkbeacon.map-settings';

export const MapSettingsExportDocument = z.object({
  format: z.literal(MAP_SETTINGS_EXPORT_FORMAT),
  version: z.literal(1),
  exportedAt: Timestamp,
  settings: MapSettings,
  labels: z.array(LabelDto).max(64),
  systemLabels: z.array(SystemLabelDto).max(32).default([]),
  /** The map's published views; absent in files written before maps had them. */
  views: z.array(MapViewDto).max(MAP_VIEWS_MAX).optional(),
});
export type MapSettingsExportDocument = z.infer<typeof MapSettingsExportDocument>;

/** POST /api/maps/:mapId/settings/import */
export const ImportMapSettingsRequest = z.object({
  document: MapSettingsExportDocument,
  /** Replace the label list too (default yes). */
  labels: z.boolean().default(true),
});
export type ImportMapSettingsRequest = z.infer<typeof ImportMapSettingsRequest>;
