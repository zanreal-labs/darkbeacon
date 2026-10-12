import { z } from 'zod';
import { Id, Timestamp } from './common.js';
import { MapKind, Slug } from './mapping.js';

/** PUT /api/maps/:mapId/owner and /api/admin/maps/:mapId/owner: hands the map to another account. */
export const TransferMapOwnerRequest = z.object({ accountId: Id });
export type TransferMapOwnerRequest = z.infer<typeof TransferMapOwnerRequest>;

/**
 * One map in the instance admins' inventory. Admins see that a map exists, who owns it and how
 * big it is, never what is on it: they get no role on maps by being instance admins.
 */
export const AdminMapDto = z.object({
  id: Id,
  slug: Slug,
  name: z.string(),
  kind: MapKind.optional(),
  description: z.string(),
  ownerAccountId: Id,
  /** The owner's account name, when it still exists. */
  ownerName: z.string().nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  /** Deleted, restorable maps carry when they were deleted. */
  deletedAt: Timestamp.nullable(),
  /** Visible systems. */
  systems: z.number().int(),
  /** Access rules. */
  rules: z.number().int(),
});
export type AdminMapDto = z.infer<typeof AdminMapDto>;

/** POST /api/maps/:mapId/duplicate: a new map from this one, owned by the caller. */
export const DuplicateMapRequest = z.object({
  name: z.string().trim().min(1).max(64),
  slug: Slug.optional(),
  /** Signatures of the systems (default yes). */
  signatures: z.boolean().default(true),
  /** The access rules (default yes; needs admin on the source). */
  accessRules: z.boolean().default(true),
});
export type DuplicateMapRequest = z.infer<typeof DuplicateMapRequest>;
