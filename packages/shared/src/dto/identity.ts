import { z } from 'zod';
import { EveId, Id, Timestamp } from './common.js';

export const InstanceRole = z.enum(['owner', 'admin', 'user']);
export type InstanceRole = z.infer<typeof InstanceRole>;

export const AccountDto = z.object({
  id: Id,
  discordId: z.string().nullable(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  instanceRole: InstanceRole,
  createdAt: Timestamp,
});
export type AccountDto = z.infer<typeof AccountDto>;

export const CharacterDto = z.object({
  id: EveId,
  name: z.string(),
  corporationId: EveId,
  allianceId: EveId.nullable(),
  /** False when the stored EVE token no longer works and the character must be re-linked. */
  tokenValid: z.boolean(),
  linkedAt: Timestamp,
});
export type CharacterDto = z.infer<typeof CharacterDto>;

/** GET /api/accounts/me */
export const MeDto = z.object({
  account: AccountDto,
  characters: z.array(CharacterDto),
});
export type MeDto = z.infer<typeof MeDto>;

/** POST /api/auth/dev (only with DEV_LOGIN=true). */
export const DevLoginRequest = z.object({
  name: z.string().trim().min(1).max(64),
  character: z
    .object({
      name: z.string().trim().min(1).max(64),
      id: EveId.optional(),
      corporationId: EveId.optional(),
      allianceId: EveId.nullable().optional(),
    })
    .optional(),
});
export type DevLoginRequest = z.infer<typeof DevLoginRequest>;

/** GET /api/auth/providers: which login buttons the web app shows. */
export const AuthProvidersDto = z.object({
  discord: z.boolean(),
  eve: z.boolean(),
  dev: z.boolean(),
});
export type AuthProvidersDto = z.infer<typeof AuthProvidersDto>;

export const AdminAccountDto = AccountDto.extend({ lastSeenAt: Timestamp.nullable() });
export type AdminAccountDto = z.infer<typeof AdminAccountDto>;

export const UpdateInstanceRoleRequest = z.object({ role: z.enum(['admin', 'user']) });
export type UpdateInstanceRoleRequest = z.infer<typeof UpdateInstanceRoleRequest>;

export const TransferOwnershipRequest = z.object({ accountId: Id });
export type TransferOwnershipRequest = z.infer<typeof TransferOwnershipRequest>;
