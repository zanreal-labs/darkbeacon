import type { InstanceRole } from '@darkbeacon/core';
import type { ApiKey } from '../domain/key.js';

export type { Clock, EventLog, MapAccess, UnitOfWork } from '@darkbeacon/core';

export interface ApiKeyRepository {
  insert(key: ApiKey): Promise<void>;
  update(key: ApiKey): Promise<void>;
  findById(id: string): Promise<ApiKey | null>;
  findByLookup(lookup: string): Promise<ApiKey | null>;
  listByOwner(accountId: string): Promise<ApiKey[]>;
  /** Every key, newest first. */
  listAll(): Promise<ApiKey[]>;
  /** Records a use outside any transaction; failures are not the request's problem. */
  touch(id: string, at: number, ip: string | null): Promise<void>;
}

/**
 * Randomness and hashing for secrets (node:crypto in the server): base62 random strings, a keyed
 * hash of a secret (HMAC-SHA256 with a pepper derived from SECRET_KEY) and a constant-time compare.
 */
export interface TokenSecrets {
  random(length: number): string;
  hash(secret: string): string;
  equals(a: string, b: string): boolean;
}

/** Provided by identity: an account as a key owner sees it now. */
export interface KeyOwnerDirectory {
  find(accountId: string): Promise<{ id: string; name: string; instanceRole: InstanceRole } | null>;
  names(accountIds: readonly string[]): Promise<Map<string, string>>;
}

/** Provided by mapping: names of maps, so keys never show raw ids. */
export interface MapNames {
  describe(mapIds: readonly string[]): Promise<Array<{ id: string; name: string; slug: string }>>;
}
