import { z } from 'zod';
import { EveId, Id, Timestamp } from './common.js';

/** Who made a change, as it was when the change was made (names are not updated later). */
export const AuditActorDto = z.object({
  kind: z.enum(['account', 'apiToken', 'public', 'system', 'plugin']),
  id: z.string(),
  /** The person behind the change: the account, or the owner of the character that moved. */
  accountId: Id.nullable(),
  accountName: z.string().nullable(),
  /** The character in use: the account's main character, or the character that jumped. */
  characterId: EveId.nullable(),
  characterName: z.string().nullable(),
});
export type AuditActorDto = z.infer<typeof AuditActorDto>;

/** How the change reached the server. */
export const AuditChannelDto = z.object({
  kind: z.enum(['web', 'api', 'mcp', 'plugin', 'system']),
  /** API key id, plugin id or the system process (`auto-mapping`, `tracking`, `identity`, ...). */
  id: z.string().nullable(),
  /** The API key's name when the change was made (`api` and `mcp`). */
  name: z.string().nullable().optional(),
});
export type AuditChannelDto = z.infer<typeof AuditChannelDto>;

/** Request origin; only map admins and instance admins see it. */
export const AuditOriginDto = z.object({
  /** ISO 3166 country code from a trusted proxy header (Cloudflare and the like), when present. */
  country: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type AuditOriginDto = z.infer<typeof AuditOriginDto>;

export const AuditFieldChange = z.object({ before: z.unknown(), after: z.unknown() });
export type AuditFieldChange = z.infer<typeof AuditFieldChange>;

export const AuditOp = z.enum(['create', 'update', 'delete', 'activity']);
export type AuditOp = z.infer<typeof AuditOp>;

/** One entry of a history: an event of the log with its audit record. */
export const AuditEntryDto = z.object({
  id: Id,
  stream: z.string(),
  seq: z.number().int().positive(),
  type: z.string(),
  occurredAt: Timestamp,
  /** The map the change belongs to (map streams and map webhooks), else null. */
  mapId: Id.nullable(),
  actor: AuditActorDto,
  channel: AuditChannelDto,
  /** Null when the caller may not see it or the change did not come over HTTP. */
  origin: AuditOriginDto.nullable(),
  op: AuditOp,
  /** What changed, e.g. `{ kind: 'system', id: '31000005' }`; null for pure activity. */
  entity: z.object({ kind: z.string(), id: z.string() }).nullable(),
  /** Field-level changes (before -> after). Removals keep the removed object in `removed`. */
  diff: z.record(z.string(), AuditFieldChange),
  removed: z.record(z.string(), z.unknown()).nullable(),
  /** This change reverted the change with this id. */
  revertOf: Id.nullable(),
  /** A later change that reverted this one. */
  revertedBy: Id.nullable(),
  /** The server knows how to revert this kind of change (it still refuses when it changed since). */
  revertible: z.boolean(),
  /** False for events written before the audit trail existed (no diff, actor names unknown). */
  recorded: z.boolean(),
});
export type AuditEntryDto = z.infer<typeof AuditEntryDto>;

export const AuditPageDto = z.object({
  entries: z.array(AuditEntryDto),
  /** Pass as `before` for the next (older) page; null at the end. */
  nextCursor: z.string().nullable(),
});
export type AuditPageDto = z.infer<typeof AuditPageDto>;

const list = z
  .string()
  .max(500)
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  );

/** Filters of a history. `types` are exact types or `prefix.*`, comma separated. */
export const AuditQuery = z.object({
  /** A person: account id. */
  accountId: Id.optional(),
  /** A person: character id. */
  characterId: z.coerce.number().int().positive().optional(),
  /** Changes touching this system (the system, its signatures and its connections). */
  solarSystemId: z.coerce.number().int().positive().optional(),
  types: list.optional(),
  /** Instance audit only: changes of one map. */
  mapId: Id.optional(),
  /** Only entries at or after this time (epoch ms). */
  since: z.coerce.number().int().nonnegative().optional(),
  before: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type AuditQuery = z.infer<typeof AuditQuery>;
export type AuditQueryInput = z.input<typeof AuditQuery>;

export const AuditExportQuery = AuditQuery.omit({ before: true, limit: true }).extend({
  format: z.enum(['csv', 'json']).default('csv'),
});
export type AuditExportQuery = z.infer<typeof AuditExportQuery>;

/** Result of reverting one change: the entries the revert wrote. */
export const AuditRevertDto = z.object({ reverted: Id, entries: z.array(AuditEntryDto) });
export type AuditRevertDto = z.infer<typeof AuditRevertDto>;

/** Hash chain check of one stream. */
export const AuditStreamCheckDto = z.object({
  stream: z.string(),
  /** Events checked (the chain starts at the oldest event still stored). */
  checked: z.number().int().nonnegative(),
  /** Events written before the chain existed; not covered. */
  unchained: z.number().int().nonnegative(),
  ok: z.boolean(),
  /** First event whose hash does not match, when not ok. */
  brokenAt: z.object({ seq: z.number().int(), id: Id }).nullable(),
});
export type AuditStreamCheckDto = z.infer<typeof AuditStreamCheckDto>;

export const AuditVerifyDto = z.object({
  ok: z.boolean(),
  checkedAt: Timestamp,
  streams: z.array(AuditStreamCheckDto),
});
export type AuditVerifyDto = z.infer<typeof AuditVerifyDto>;
