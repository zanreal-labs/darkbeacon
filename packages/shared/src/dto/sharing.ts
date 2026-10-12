import { z } from 'zod';
import { shareScope, type ShareScope } from '../share-scope.js';
import { Id, Timestamp } from './common.js';
import { Slug } from './mapping.js';

/** `read`: the target sees the shared data; `read-write`: its editors may also change it (written back). */
export const ShareLevel = z.enum(['read', 'read-write']);
export type ShareLevel = z.infer<typeof ShareLevel>;

/** What a new share offers unless the offer says otherwise. */
export const DEFAULT_SHARE_SCOPES: readonly ShareScope[] = ['topology', 'connectionStatus', 'signatures'];

/**
 * Where a map lives: `local` for this instance, else the id of the instance it is on (federation;
 * only `local` exists today). With `mapId` it names a map anywhere.
 */
export const ChainOrigin = z.object({
  instance: z.string().min(1).max(200),
  mapId: Id,
});
export type ChainOrigin = z.infer<typeof ChainOrigin>;
export const LOCAL_INSTANCE = 'local';

export const ShareStatus = z.enum(['offered', 'active']);
export type ShareStatus = z.infer<typeof ShareStatus>;

/** A share of one map (source) with another (target), as both sides' admins see it. */
export const MapShareDto = z.object({
  id: Id,
  source: ChainOrigin,
  sourceName: z.string(),
  target: ChainOrigin,
  targetName: z.string(),
  /** Name of the source's instance; null when it is this one. */
  sourceInstanceName: z.string().nullable(),
  level: ShareLevel,
  /** What the source offers (topology is always part of it). */
  offeredScopes: z.array(shareScope),
  /** What the target receives: the offer, narrowed by the target's admins. */
  scopes: z.array(shareScope),
  status: ShareStatus,
  /**
   * A higher level the source's admins offer on an active share (read -> read-write); it applies
   * once the target's admins accept it, until then `level` stays. Null when nothing is pending.
   */
  offeredLevel: ShareLevel.nullable(),
  /** Hidden by the target's admins for now: nothing of it is shown, the share stays. */
  hidden: z.boolean(),
  /** On a composite: new systems and connections made on it go to this source (read-write only). */
  defaultWrite: z.boolean(),
  offeredAt: Timestamp,
  acceptedAt: Timestamp.nullable(),
  updatedAt: Timestamp,
});
export type MapShareDto = z.infer<typeof MapShareDto>;

/** GET /api/maps/:mapId/shares (map admins): what the map gives and what it gets. */
export const MapSharesDto = z.object({
  outgoing: z.array(MapShareDto),
  incoming: z.array(MapShareDto),
});
export type MapSharesDto = z.infer<typeof MapSharesDto>;

/** POST /api/maps/:mapId/shares: the source's admin offers the map to another map. */
export const OfferShareRequest = z
  .object({
    /** A map the caller can see, by id ... */
    targetMapId: Id.optional(),
    /** ... or by its address. */
    targetSlug: Slug.optional(),
    level: ShareLevel.default('read'),
    scopes: z.array(shareScope).max(16).optional(),
  })
  .refine((r) => !!r.targetMapId !== !!r.targetSlug, {
    message: 'name the target map by id or by address',
    path: ['targetMapId'],
  });
export type OfferShareRequest = z.infer<typeof OfferShareRequest>;

/**
 * PATCH /api/maps/:mapId/shares/:shareId. The source's admins change `level` and `scopes` (the
 * offer); the target's admins narrow `scopes` (never past the offer) and hide the share.
 */
export const UpdateShareRequest = z.object({
  level: ShareLevel.optional(),
  scopes: z.array(shareScope).max(16).optional(),
  hidden: z.boolean().optional(),
  /** Target admins of a composite: make this source where new objects go. */
  defaultWrite: z.literal(true).optional(),
});
export type UpdateShareRequest = z.infer<typeof UpdateShareRequest>;

/** POST /api/maps/:mapId/shares/:shareId/accept: the target's admin accepts, optionally narrowing. */
export const AcceptShareRequest = z.object({ scopes: z.array(shareScope).max(16).optional() });
export type AcceptShareRequest = z.infer<typeof AcceptShareRequest>;

/** A map merged into this one, as its viewers see it (snapshot `sources`, `map.sources_changed`). */
export const MapSourceDto = z.object({
  /** Share id; `self` for the map's own objects. */
  id: Id,
  origin: ChainOrigin,
  name: z.string(),
  instanceName: z.string().nullable(),
  level: ShareLevel,
  scopes: z.array(shareScope),
  hidden: z.boolean(),
});
export type MapSourceDto = z.infer<typeof MapSourceDto>;

// The wire format of merge input: what a source tells a map that merges it. Built to travel between
// instances one day, so it names objects by stable game keys (never by database ids), stamps every
// field with when it changed and carries deletions as tombstones.

/** A field value and when it last changed at its origin (epoch ms). */
export const StampedValue = z.object({ v: z.unknown(), at: Timestamp });
export type StampedValue = z.infer<typeof StampedValue>;

export const ChainObjectKind = z.enum(['system', 'connection', 'signature', 'character']);
export type ChainObjectKind = z.infer<typeof ChainObjectKind>;

/**
 * Stable keys: a system by solar system id (`31000005`), a connection by its unordered pair
 * (`<low>-<high>`), a signature by system and code (`31000005:ABC-123`), a character by its id.
 */
export const ChainKey = z.string().min(1).max(64);

export const ChainEntry = z.discriminatedUnion('state', [
  /** The origin holds the object; `fields` are the ones the share's scopes let through. */
  z.object({
    kind: ChainObjectKind,
    key: ChainKey,
    state: z.literal('present'),
    /** When the origin created (or last re-created) the object. */
    born: Timestamp,
    fields: z.record(z.string(), StampedValue),
  }),
  /** The origin does not hold the object (never had it, or only stopped showing it). */
  z.object({ kind: ChainObjectKind, key: ChainKey, state: z.literal('absent') }),
  /** The origin deleted the object at `at`: older copies elsewhere are gone too. */
  z.object({ kind: ChainObjectKind, key: ChainKey, state: z.literal('deleted'), at: Timestamp }),
]);
export type ChainEntry = z.infer<typeof ChainEntry>;

export const ChainDelta = z.object({
  v: z.literal(1),
  origin: ChainOrigin,
  /** The scopes the entries were cut to. */
  scopes: z.array(shareScope),
  /** True: the whole state of the origin; objects not listed are absent. */
  full: z.boolean(),
  entries: z.array(ChainEntry),
  /** When the origin produced the delta. */
  at: Timestamp,
});
export type ChainDelta = z.infer<typeof ChainDelta>;

/**
 * Actor ids of the events a merged map writes from its sources. On a composite they are the map's
 * own news (`sharing`); on a map with objects of its own they repeat what its sources said
 * (`sharing-copy`), so webhooks and plugins there see only the map's own events.
 */
export const MERGE_ACTOR_ID = 'sharing';
export const MERGE_COPY_ACTOR_ID = 'sharing-copy';

/** Written by the merge of a map (either kind). */
export function isMergeEvent(event: { actor: { kind: string; id: string } }): boolean {
  return (
    event.actor.kind === 'system' &&
    (event.actor.id === MERGE_ACTOR_ID || event.actor.id === MERGE_COPY_ACTOR_ID)
  );
}

/** A merged copy on a map with objects of its own: not for webhooks and plugins. */
export function isMergedCopy(event: { actor: { kind: string; id: string } }): boolean {
  return event.actor.kind === 'system' && event.actor.id === MERGE_COPY_ACTOR_ID;
}
