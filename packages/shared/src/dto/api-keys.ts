import { z } from 'zod';
import { isCidr } from '../cidr.js';
import { ApiScope, isReservedScope } from '../scopes.js';
import { Id, Timestamp } from './common.js';

/** `pat`: a personal access token, acting as the account that made it. `svc`: a service key. */
export const ApiKeyKind = z.enum(['pat', 'svc']);
export type ApiKeyKind = z.infer<typeof ApiKeyKind>;

export const ApiKeyStatus = z.enum(['active', 'expired', 'revoked']);
export type ApiKeyStatus = z.infer<typeof ApiKeyStatus>;

export const Cidr = z
  .string()
  .trim()
  .max(64)
  .refine(isCidr, { message: 'expected an IP address or CIDR range' });

export const GrantingRole = z.enum(['viewer', 'member', 'manager', 'admin']);

/** A map a service key is bound to, with its role there. */
export const ServiceKeyMapGrant = z.object({ mapId: Id, role: GrantingRole });
export type ServiceKeyMapGrant = z.infer<typeof ServiceKeyMapGrant>;

export const ApiKeyMapRef = z.object({ id: Id, name: z.string(), slug: z.string() });

export const ApiKeyDto = z.object({
  id: Id,
  kind: ApiKeyKind,
  name: z.string(),
  /** The first characters of the token (`dbk_pat_3fZ…`), enough to recognise it; not a secret. */
  prefix: z.string(),
  scopes: z.array(z.string()),
  /** Only GET requests and read tools, whatever the scopes say. */
  readOnly: z.boolean(),
  expiresAt: Timestamp.nullable(),
  /** IP addresses or CIDR ranges the key may be used from; empty: anywhere. */
  allowedIps: z.array(z.string()),
  /** Requests a minute; null: the instance default. */
  rateLimitPerMinute: z.number().int().positive().nullable(),
  /** The account a personal token acts as; null for service keys. */
  ownerAccountId: Id.nullable(),
  /** Who made the key, by name. */
  createdBy: z.object({ accountId: Id.nullable(), name: z.string().nullable() }),
  /** Service keys: their instance role and map roles. */
  instanceRole: z.enum(['user', 'admin']).nullable(),
  mapGrants: z.array(ServiceKeyMapGrant),
  /** Service keys: a role on every map of the instance (null: only `mapGrants`). */
  allMapsRole: GrantingRole.nullable(),
  /** Names of the maps the scopes and grants refer to, so screens never show raw ids. */
  maps: z.array(ApiKeyMapRef),
  status: ApiKeyStatus,
  createdAt: Timestamp,
  rotatedAt: Timestamp.nullable(),
  lastUsedAt: Timestamp.nullable(),
  /** Where it was used from last (the client address as the server saw it). */
  lastUsedIp: z.string().nullable(),
  revokedAt: Timestamp.nullable(),
});
export type ApiKeyDto = z.infer<typeof ApiKeyDto>;

/** The token is shown once, on creation and rotation; only its hash is kept. */
export const CreatedApiKeyDto = z.object({ key: ApiKeyDto, token: z.string() });
export type CreatedApiKeyDto = z.infer<typeof CreatedApiKeyDto>;

const ScopeList = z
  .array(ApiScope)
  .min(1)
  .max(64)
  .refine((scopes) => !scopes.some(isReservedScope), { message: 'federation scopes are reserved for later' });

export const CreateApiKeyRequest = z.object({
  name: z.string().trim().min(1).max(64),
  scopes: ScopeList,
  readOnly: z.boolean().default(false),
  /** Epoch ms; null or absent: never expires. */
  expiresAt: Timestamp.nullable().optional(),
  allowedIps: z.array(Cidr).max(20).default([]),
  rateLimitPerMinute: z.number().int().min(1).max(10_000).nullable().optional(),
});
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequest>;

export const CreateServiceKeyRequest = CreateApiKeyRequest.extend({
  instanceRole: z.enum(['user', 'admin']).default('user'),
  mapGrants: z.array(ServiceKeyMapGrant).max(100).default([]),
  allMapsRole: GrantingRole.nullable().default(null),
});
export type CreateServiceKeyRequest = z.infer<typeof CreateServiceKeyRequest>;

/** Rename, re-scope... are not offered: make a new key. Rotation keeps everything but the secret. */
export const UpdateApiKeyRequest = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  allowedIps: z.array(Cidr).max(20).optional(),
  rateLimitPerMinute: z.number().int().min(1).max(10_000).nullable().optional(),
});
export type UpdateApiKeyRequest = z.infer<typeof UpdateApiKeyRequest>;
