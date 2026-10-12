import { z } from 'zod';
import { shareScope } from '../share-scope.js';
import { Id, Timestamp } from './common.js';
import { ConnectionDto, LabelDto, MapSystemDto, SignatureDto, Slug, SystemLabelDto } from './mapping.js';
import { MapExitDto } from './routing.js';
import { CharacterPresenceDto } from './tracking.js';
import { UniverseSystemDto } from './universe.js';

/**
 * How AI agents (the MCP endpoint at `/mcp`) may reach a map, within the instance's MCP mode:
 * `off` never, `authenticated` with an API key whose scopes name the map, `public` also anonymously
 * and read-only when the map is public (only what its public view shows).
 */
export const McpMode = z.enum(['off', 'authenticated', 'public']);
export type McpMode = z.infer<typeof McpMode>;

/** Public link of a map: who may see what without signing in. Map admins only. */
export const PublicLinkDto = z.object({
  mapId: Id,
  /** Anyone with the link sees the map read-only. */
  enabled: z.boolean(),
  /** The unguessable part of `/p/<token>`; kept when sharing is switched off, until regenerated. */
  token: z.string().nullable(),
  /** Optional readable alias: `/p/<slug>`. */
  slug: Slug.nullable(),
  /** `/p/<token>` on this instance, when enabled. */
  url: z.string().nullable(),
  /** What the public view shows; `topology` is always part of it. */
  scopes: z.array(shareScope),
  /** Ask search engines not to index the public view (on by default). */
  noindex: z.boolean(),
  mcpMode: McpMode,
  updatedAt: Timestamp.nullable(),
});
export type PublicLinkDto = z.infer<typeof PublicLinkDto>;

export const UpdatePublicLinkRequest = z.object({
  enabled: z.boolean().optional(),
  slug: Slug.nullable().optional(),
  scopes: z.array(shareScope).max(6).optional(),
  noindex: z.boolean().optional(),
  mcpMode: McpMode.optional(),
});
export type UpdatePublicLinkRequest = z.infer<typeof UpdatePublicLinkRequest>;

/** The map as its public view shows it: no owner, no settings, labels only when shared. */
export const PublicMapDto = z.object({
  id: Id,
  name: z.string(),
  labels: z.array(LabelDto),
  systemLabels: z.array(SystemLabelDto).default([]),
  scopes: z.array(shareScope),
  noindex: z.boolean(),
});
export type PublicMapDto = z.infer<typeof PublicMapDto>;

/**
 * The parts of a public snapshot. Fields a scope does not share are blanked on the server (empty
 * notes, `unknown` status, no labels...), never sent; parts it does not share are absent.
 */
export const PublicSnapshotDto = z.object({
  systems: z.array(MapSystemDto),
  connections: z.array(ConnectionDto),
  exits: z.array(MapExitDto).optional(),
  signatures: z.array(SignatureDto).optional(),
  characters: z.array(CharacterPresenceDto).optional(),
});
export type PublicSnapshotDto = z.infer<typeof PublicSnapshotDto>;

/**
 * GET /api/public/maps/:token: everything the public page needs, read without a session. Then the
 * page follows `stream` over /ws (anonymous, read-only) from `seq`.
 */
export const PublicMapViewDto = z.object({
  map: PublicMapDto,
  stream: z.string(),
  seq: z.number().int().min(0),
  snapshot: PublicSnapshotDto,
  /** Static data of every system on the map, so names, classes and statics show at once. */
  universe: z.array(UniverseSystemDto),
});
export type PublicMapViewDto = z.infer<typeof PublicMapViewDto>;
