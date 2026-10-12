import { createHmac, hkdfSync, randomInt, timingSafeEqual } from 'node:crypto';
import { BASE62, type ApiKey, type ApiKeyRepository, type TokenSecrets } from '@darkbeacon/api-keys';
import type { GrantingMapRole } from '@darkbeacon/core';
import { bool, json, type Database } from '@darkbeacon/db';
import type { ServiceKeyMapGrant } from '@darkbeacon/shared';

export interface ApiKeyTables {
  api_key: {
    id: string;
    kind: string;
    name: string;
    lookup: string;
    secret_hash: string;
    scopes: string;
    read_only: number;
    expires_at: number | null;
    allowed_ips: string;
    rate_limit_per_minute: number | null;
    owner_account_id: string | null;
    created_by: string;
    instance_role: string | null;
    map_grants: string;
    all_maps_role: string | null;
    created_at: number;
    rotated_at: number | null;
    last_used_at: number | null;
    last_used_ip: string | null;
    revoked_at: number | null;
  };
}

type Row = ApiKeyTables['api_key'];
const num = (v: number | null) => (v === null ? null : Number(v));

function toKey(row: Row): ApiKey {
  return {
    id: row.id,
    kind: row.kind as ApiKey['kind'],
    name: row.name,
    lookup: row.lookup,
    secretHash: row.secret_hash,
    scopes: json.decode<string[]>(row.scopes) ?? [],
    readOnly: bool.decode(row.read_only),
    expiresAt: num(row.expires_at),
    allowedIps: json.decode<string[]>(row.allowed_ips) ?? [],
    rateLimitPerMinute: num(row.rate_limit_per_minute),
    ownerAccountId: row.owner_account_id,
    createdBy: row.created_by,
    instanceRole: row.instance_role as ApiKey['instanceRole'],
    mapGrants: json.decode<ServiceKeyMapGrant[]>(row.map_grants) ?? [],
    allMapsRole: row.all_maps_role as GrantingMapRole | null,
    createdAt: Number(row.created_at),
    rotatedAt: num(row.rotated_at),
    lastUsedAt: num(row.last_used_at),
    lastUsedIp: row.last_used_ip,
    revokedAt: num(row.revoked_at),
  };
}

function toRow(key: ApiKey): Row {
  return {
    id: key.id,
    kind: key.kind,
    name: key.name,
    lookup: key.lookup,
    secret_hash: key.secretHash,
    scopes: json.encode(key.scopes),
    read_only: bool.encode(key.readOnly),
    expires_at: key.expiresAt,
    allowed_ips: json.encode(key.allowedIps),
    rate_limit_per_minute: key.rateLimitPerMinute,
    owner_account_id: key.ownerAccountId,
    created_by: key.createdBy,
    instance_role: key.instanceRole,
    map_grants: json.encode(key.mapGrants),
    all_maps_role: key.allMapsRole,
    created_at: key.createdAt,
    rotated_at: key.rotatedAt,
    last_used_at: key.lastUsedAt,
    last_used_ip: key.lastUsedIp,
    revoked_at: key.revokedAt,
  };
}

export class KyselyApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<ApiKeyTables>();
  }

  async insert(key: ApiKey): Promise<void> {
    await this.db.insertInto('api_key').values(toRow(key)).execute();
  }

  async update(key: ApiKey): Promise<void> {
    const { id: _id, created_at: _created, ...rest } = toRow(key);
    await this.db.updateTable('api_key').set(rest).where('id', '=', key.id).execute();
  }

  async findById(id: string): Promise<ApiKey | null> {
    const row = await this.db.selectFrom('api_key').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? toKey(row) : null;
  }

  async findByLookup(lookup: string): Promise<ApiKey | null> {
    const row = await this.db
      .selectFrom('api_key')
      .selectAll()
      .where('lookup', '=', lookup)
      .executeTakeFirst();
    return row ? toKey(row) : null;
  }

  async listByOwner(accountId: string): Promise<ApiKey[]> {
    const rows = await this.db
      .selectFrom('api_key')
      .selectAll()
      .where('owner_account_id', '=', accountId)
      .where('kind', '=', 'pat')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return rows.map(toKey);
  }

  async listAll(): Promise<ApiKey[]> {
    const rows = await this.db
      .selectFrom('api_key')
      .selectAll()
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return rows.map(toKey);
  }

  async touch(id: string, at: number, ip: string | null): Promise<void> {
    await this.db
      .updateTable('api_key')
      .set({ last_used_at: at, last_used_ip: ip })
      .where('id', '=', id)
      .execute();
  }
}

/**
 * Secrets of API keys. A slow password hash (argon2id) protects secrets people choose; these carry
 * ~190 random bits, which no amount of guessing gets through, so it would only cost every API
 * request tens of milliseconds and turn invalid tokens into an easy way to burn CPU. A keyed hash
 * is enough:
 * HMAC-SHA256 with a pepper derived from SECRET_KEY, so the `api_key` table alone (a backup, a
 * leaked dump) does not let anyone check guesses. Compared in constant time.
 */
export class HmacTokenSecrets implements TokenSecrets {
  private readonly pepper: Buffer;

  constructor(secretKey: string) {
    this.pepper = Buffer.from(hkdfSync('sha256', secretKey, 'darkbeacon', 'api-keys', 32));
  }

  random(length: number): string {
    let out = '';
    for (let i = 0; i < length; i++) out += BASE62[randomInt(62)];
    return out;
  }

  hash(secret: string): string {
    return createHmac('sha256', this.pepper).update(secret).digest('base64url');
  }

  equals(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
