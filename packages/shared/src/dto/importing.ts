import { z } from 'zod';
import { AccessSubjectKind, MapRole } from './access.js';
import { Id, Timestamp } from './common.js';
import { Slug } from './mapping.js';

/**
 * Imports of whole maps from Wanderer (https://wanderer.ltd and self-hosted instances), over its
 * public API with a map API key or from the JSON file its UI exports. See
 * docs/migrate-from-wanderer.md.
 */

/** Content type of an uploaded Wanderer export file (the raw JSON as the request body). */
export const WANDERER_EXPORT_CONTENT_TYPE = 'application/vnd.darkbeacon.wanderer-export+json';

/** Largest Wanderer export file accepted (bytes). */
export const MAX_WANDERER_EXPORT_BYTES = 25 * 1024 * 1024;

/** A Wanderer instance and map: `https://wanderer.ltd` + `home-chain` + the map's API key. */
export const WandererApiSourceRequest = z.object({
  /** The instance address, e.g. `https://wanderer.ltd` or `https://wanderer.example.org:8443`. */
  baseUrl: z.string().trim().min(1).max(300),
  /** The map's slug (the part after `/` in the map's address) or its UUID. */
  slug: z.string().trim().min(1).max(100),
  /** The map API key from Wanderer's map settings (Bearer token). */
  apiKey: z.string().trim().min(1).max(500),
  /** ACL API keys, for ACLs whose members the map key cannot read (one key per ACL). */
  aclKeys: z
    .array(z.object({ aclId: z.string().trim().min(1).max(100), key: z.string().trim().min(1).max(500) }))
    .max(50)
    .optional(),
  /** Accept a self-signed TLS certificate (instance admins only). */
  insecureTls: z.boolean().optional(),
});
export type WandererApiSourceRequest = z.infer<typeof WandererApiSourceRequest>;

export const ImportSourceKind = z.enum(['wanderer-api', 'wanderer-file']);
export type ImportSourceKind = z.infer<typeof ImportSourceKind>;

/** Where an import came from, as shown to people (never the key). */
export const ImportSourceDto = z.object({
  kind: ImportSourceKind,
  /** `wanderer.ltd`, `wanderer.example.org:8443`, or `file` for an uploaded export. */
  host: z.string(),
  /** The Wanderer map's slug, or the export file's map name. */
  slug: z.string(),
  /** The Wanderer map's name when known. */
  name: z.string().nullable(),
});
export type ImportSourceDto = z.infer<typeof ImportSourceDto>;

/** POST /api/imports/wanderer/test: whether the instance answers and the key works. */
export const WandererTestResultDto = z.object({
  ok: z.boolean(),
  host: z.string(),
  /** Systems the key can read (visible and hidden). */
  systems: z.number().int(),
  /** Why it did not work, in words. */
  message: z.string().nullable(),
});
export type WandererTestResultDto = z.infer<typeof WandererTestResultDto>;

export const ImportReportBucket = z.enum(['mapped', 'approximated', 'dropped']);
export type ImportReportBucket = z.infer<typeof ImportReportBucket>;

/** One line of a mapping report: "12 systems: status Target (secondary) became Target". */
export const ImportReportLineDto = z.object({
  bucket: ImportReportBucket,
  /** system, connection, signature, structure, comment, label, access, setting, character... */
  kind: z.string(),
  what: z.string(),
  why: z.string().nullable(),
  count: z.number().int(),
  /** A few of the things it is about (system names, signature ids). */
  examples: z.array(z.string()),
});
export type ImportReportLineDto = z.infer<typeof ImportReportLineDto>;

export const ImportCountsDto = z.object({
  systems: z.number().int(),
  hiddenSystems: z.number().int(),
  connections: z.number().int(),
  signatures: z.number().int(),
  structures: z.number().int(),
  comments: z.number().int(),
  labels: z.number().int(),
  accessRules: z.number().int(),
  hubs: z.number().int(),
});
export type ImportCountsDto = z.infer<typeof ImportCountsDto>;

/** A Wanderer ACL member as it will become a Darkbeacon access rule. */
export const ImportAccessEntryDto = z.object({
  subjectKind: AccessSubjectKind.extract(['character', 'corporation', 'alliance']),
  subjectId: z.string(),
  /** The name Wanderer had for it. */
  wandererName: z.string().nullable(),
  /** The name ESI gives it now; null when ESI could not be asked or does not know it. */
  esiName: z.string().nullable(),
  ticker: z.string().nullable(),
  /** The Wanderer role (admin, manager, member, viewer, blocked). */
  wandererRole: z.string(),
  role: MapRole,
  /** The Wanderer ACLs it came from. */
  acls: z.array(z.string()),
  /** Why the role differs from Wanderer's, or what happens to an existing rule. */
  note: z.string().nullable(),
});
export type ImportAccessEntryDto = z.infer<typeof ImportAccessEntryDto>;

export const ImportJobStatus = z.enum(['preview', 'queued', 'running', 'done', 'failed', 'cancelled']);
export type ImportJobStatus = z.infer<typeof ImportJobStatus>;

export const ImportMode = z.enum(['new', 'merge']);
export type ImportMode = z.infer<typeof ImportMode>;

/** What happened to each kind of thing, after (or during) an import. */
export const ImportOutcomeDto = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  skipped: z.number().int(),
  removed: z.number().int(),
});
export type ImportOutcomeDto = z.infer<typeof ImportOutcomeDto>;

/** One import: staged by a preview, then run as a server job. */
export const ImportJobDto = z.object({
  id: Id,
  status: ImportJobStatus,
  source: ImportSourceDto,
  mode: ImportMode.nullable(),
  /** The Darkbeacon map it went into (set once the import started). */
  mapId: Id.nullable(),
  mapSlug: z.string().nullable(),
  mapName: z.string().nullable(),
  /** `systems`, `connections`, `signatures`, `access`, `settings`, `done`. */
  phase: z.string(),
  done: z.number().int(),
  total: z.number().int(),
  counts: ImportCountsDto,
  report: z.array(ImportReportLineDto),
  access: z.array(ImportAccessEntryDto),
  /** Per kind, after the import ran: `systems`, `connections`, `signatures`, `labels`, `access`. */
  outcome: z.record(z.string(), ImportOutcomeDto),
  /** Problems reading the source that did not stop it (an endpoint that failed, a bad row). */
  warnings: z.array(z.string()),
  error: z.string().nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  finishedAt: Timestamp.nullable(),
  /** Set when the import keeps pulling from Wanderer (see ImportSyncDto). */
  syncId: Id.nullable(),
});
export type ImportJobDto = z.infer<typeof ImportJobDto>;

/** A field both sides changed differently, and which side a merge keeps. */
export const ImportConflictDto = z.object({
  kind: z.enum(['system', 'connection', 'signature', 'access']),
  /** System name, `J123456 ↔ J654321`, `ABC-123 in J123456`, a subject name. */
  name: z.string(),
  field: z.string(),
  here: z.string(),
  wanderer: z.string(),
  keeps: z.enum(['here', 'wanderer']),
  why: z.string(),
});
export type ImportConflictDto = z.infer<typeof ImportConflictDto>;

/** POST /api/imports/:jobId/plan: what an import into a new map or a merge would do. */
export const ImportPlanRequest = z.object({
  mode: ImportMode,
  /** The map to merge into (mode `merge`). */
  mapId: Id.optional(),
});
export type ImportPlanRequest = z.infer<typeof ImportPlanRequest>;

export const ImportPlanDto = z.object({
  mode: ImportMode,
  mapId: Id.nullable(),
  /** Per kind: how many would be created, updated, left alone, skipped. */
  outcome: z.record(z.string(), ImportOutcomeDto),
  conflicts: z.array(ImportConflictDto),
  /** More conflicts than listed. */
  moreConflicts: z.number().int(),
  /** Why the access rules would not be imported (not a map admin), or null. */
  accessBlocked: z.string().nullable(),
});
export type ImportPlanDto = z.infer<typeof ImportPlanDto>;

export const ImportSyncRequest = z.object({
  /** Pull again every N minutes (5 to 1440). */
  intervalMinutes: z.number().int().min(5).max(1440),
  /** Also remove here what Wanderer removed (only what came from Wanderer and is unchanged here). */
  removeMissing: z.boolean().default(false),
});
export type ImportSyncRequest = z.infer<typeof ImportSyncRequest>;

export const StartImportRequest = z
  .object({
    mode: ImportMode,
    /** Map to merge into (mode `merge`). */
    mapId: Id.optional(),
    /** Name and address of the new map (mode `new`); the Wanderer map's by default. */
    name: z.string().trim().min(1).max(64).optional(),
    slug: Slug.optional(),
    /** Turn Wanderer ACL members into access rules (default true; map admins only on merge). */
    includeAccess: z.boolean().default(true),
    /** Remove here what Wanderer no longer has (merge; only what came from Wanderer). */
    removeMissing: z.boolean().default(false),
    /** Keep pulling from Wanderer (API sources only). */
    keepSyncing: ImportSyncRequest.optional(),
  })
  .refine((r) => r.mode !== 'merge' || !!r.mapId, { message: 'mapId is required to merge', path: ['mapId'] });
export type StartImportRequest = z.infer<typeof StartImportRequest>;

/** A map pulling from Wanderer every few minutes until someone stops it. */
export const ImportSyncDto = z.object({
  id: Id,
  mapId: Id,
  source: ImportSourceDto,
  intervalMinutes: z.number().int(),
  removeMissing: z.boolean(),
  /** Who set it up (it runs with their rights). */
  accountId: Id,
  enabled: z.boolean(),
  lastRunAt: Timestamp.nullable(),
  lastJobId: Id.nullable(),
  /** Why the last pull failed, or null. */
  lastError: z.string().nullable(),
  nextRunAt: Timestamp.nullable(),
  createdAt: Timestamp,
});
export type ImportSyncDto = z.infer<typeof ImportSyncDto>;

/** `data` of a snapshot on an `import:<jobId>` stream. */
export interface ImportJobSnapshot {
  job?: ImportJobDto;
}
