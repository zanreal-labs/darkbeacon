import { z } from 'zod';
import { EveId, Id, Timestamp } from './common.js';

/** Every linked EVE character of the instance, for its admins (Wanderer's admin character list). */
export const AdminCharacterDto = z.object({
  id: EveId,
  name: z.string(),
  corporationId: EveId,
  allianceId: EveId.nullable(),
  accountId: Id,
  accountName: z.string().nullable(),
  tokenValid: z.boolean(),
  linkedAt: Timestamp,
});
export type AdminCharacterDto = z.infer<typeof AdminCharacterDto>;

/** PUT /api/admin/accounts/:accountId/disabled */
export const SetAccountDisabledRequest = z.object({
  disabled: z.boolean(),
  reason: z.string().trim().max(200).nullable().optional(),
});
export type SetAccountDisabledRequest = z.infer<typeof SetAccountDisabledRequest>;

/** An invite link to sign up while sign-up is restricted (the link itself is shown once). */
export const InviteDto = z.object({
  id: Id,
  note: z.string().nullable(),
  createdBy: Id,
  createdAt: Timestamp,
  expiresAt: Timestamp.nullable(),
  maxUses: z.number().int().nullable(),
  uses: z.number().int(),
  revokedAt: Timestamp.nullable(),
  /** Still usable: not revoked, not expired, uses left. */
  active: z.boolean(),
});
export type InviteDto = z.infer<typeof InviteDto>;

export const CreateInviteRequest = z.object({
  note: z.string().trim().max(100).nullable().optional(),
  /** Days until it expires; null: never. */
  expiresInDays: z.number().int().min(1).max(365).nullable().default(7),
  /** How many sign-ups it allows; null: any number. */
  maxUses: z.number().int().min(1).max(1000).nullable().default(1),
});
export type CreateInviteRequest = z.infer<typeof CreateInviteRequest>;

/** The new invite with its link (`/login?invite=<token>`), shown only now. */
export const CreatedInviteDto = z.object({ invite: InviteDto, token: z.string(), url: z.string() });
export type CreatedInviteDto = z.infer<typeof CreatedInviteDto>;
