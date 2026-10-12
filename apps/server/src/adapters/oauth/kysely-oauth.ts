import { createHash, createHmac, hkdfSync, randomInt, timingSafeEqual } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { bool, json, type Database } from '@darkbeacon/db';
import type {
  AuthorizationCode,
  ClientMetadataFetcher,
  OAuthClient,
  OAuthGrant,
  OAuthSecrets,
  OAuthStore,
  OAuthToken,
  TokenKind,
} from '@darkbeacon/oauth';
import { BASE62 } from '@darkbeacon/shared';
import { isPublicAddress, publicOnlyLookup } from '../notifications/http-webhook-sender.js';

export interface OAuthTables {
  oauth_client: {
    id: string;
    kind: string;
    name: string;
    uri: string | null;
    redirect_uris: string;
    created_at: number;
    fetched_at: number;
  };
  oauth_grant: {
    id: string;
    account_id: string;
    client_id: string;
    client_name: string;
    client_uri: string | null;
    scopes: string;
    read_only: number;
    resource: string;
    created_at: number;
    last_used_at: number | null;
    last_used_ip: string | null;
    revoked_at: number | null;
  };
  oauth_code: {
    lookup: string;
    secret_hash: string;
    grant_id: string;
    client_id: string;
    redirect_uri: string;
    code_challenge: string;
    resource: string;
    expires_at: number;
    used_at: number | null;
  };
  oauth_token: {
    lookup: string;
    secret_hash: string;
    kind: string;
    grant_id: string;
    created_at: number;
    expires_at: number;
    used_at: number | null;
  };
}

const num = (v: number | null) => (v === null ? null : Number(v));

function toGrant(row: OAuthTables['oauth_grant']): OAuthGrant {
  return {
    id: row.id,
    accountId: row.account_id,
    clientId: row.client_id,
    clientName: row.client_name,
    clientUri: row.client_uri,
    scopes: json.decode<string[]>(row.scopes) ?? [],
    readOnly: bool.decode(row.read_only),
    resource: row.resource,
    createdAt: Number(row.created_at),
    lastUsedAt: num(row.last_used_at),
    lastUsedIp: row.last_used_ip,
    revokedAt: num(row.revoked_at),
  };
}

function grantRow(grant: OAuthGrant): OAuthTables['oauth_grant'] {
  return {
    id: grant.id,
    account_id: grant.accountId,
    client_id: grant.clientId,
    client_name: grant.clientName,
    client_uri: grant.clientUri,
    scopes: json.encode(grant.scopes),
    read_only: bool.encode(grant.readOnly),
    resource: grant.resource,
    created_at: grant.createdAt,
    last_used_at: grant.lastUsedAt,
    last_used_ip: grant.lastUsedIp,
    revoked_at: grant.revokedAt,
  };
}

export class KyselyOAuthStore implements OAuthStore {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<OAuthTables>();
  }

  async findClient(id: string): Promise<OAuthClient | null> {
    const row = await this.db.selectFrom('oauth_client').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      kind: row.kind as OAuthClient['kind'],
      name: row.name,
      uri: row.uri,
      redirectUris: json.decode<string[]>(row.redirect_uris) ?? [],
      createdAt: Number(row.created_at),
      fetchedAt: Number(row.fetched_at),
    };
  }

  async saveClient(client: OAuthClient): Promise<void> {
    const row = {
      id: client.id,
      kind: client.kind,
      name: client.name,
      uri: client.uri,
      redirect_uris: json.encode(client.redirectUris),
      created_at: client.createdAt,
      fetched_at: client.fetchedAt,
    };
    const { id: _id, ...rest } = row;
    await this.db
      .insertInto('oauth_client')
      .values(row)
      .onConflict((oc) => oc.column('id').doUpdateSet(rest))
      .execute();
  }

  async insertGrant(grant: OAuthGrant): Promise<void> {
    await this.db.insertInto('oauth_grant').values(grantRow(grant)).execute();
  }

  async updateGrant(grant: OAuthGrant): Promise<void> {
    const { id: _id, ...rest } = grantRow(grant);
    await this.db.updateTable('oauth_grant').set(rest).where('id', '=', grant.id).execute();
  }

  async findGrant(id: string): Promise<OAuthGrant | null> {
    const row = await this.db.selectFrom('oauth_grant').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? toGrant(row) : null;
  }

  async listGrants(accountId: string): Promise<OAuthGrant[]> {
    const rows = await this.db
      .selectFrom('oauth_grant')
      .selectAll()
      .where('account_id', '=', accountId)
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map(toGrant);
  }

  async touchGrant(id: string, at: number, ip: string | null): Promise<void> {
    await this.db
      .updateTable('oauth_grant')
      .set({ last_used_at: at, last_used_ip: ip })
      .where('id', '=', id)
      .execute();
  }

  async insertCode(code: AuthorizationCode): Promise<void> {
    await this.db
      .insertInto('oauth_code')
      .values({
        lookup: code.lookup,
        secret_hash: code.secretHash,
        grant_id: code.grantId,
        client_id: code.clientId,
        redirect_uri: code.redirectUri,
        code_challenge: code.codeChallenge,
        resource: code.resource,
        expires_at: code.expiresAt,
        used_at: code.usedAt,
      })
      .execute();
  }

  async findCode(lookup: string): Promise<AuthorizationCode | null> {
    const row = await this.db
      .selectFrom('oauth_code')
      .selectAll()
      .where('lookup', '=', lookup)
      .executeTakeFirst();
    if (!row) return null;
    return {
      lookup: row.lookup,
      secretHash: row.secret_hash,
      grantId: row.grant_id,
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      codeChallenge: row.code_challenge,
      resource: row.resource,
      expiresAt: Number(row.expires_at),
      usedAt: num(row.used_at),
    };
  }

  async useCode(lookup: string, at: number): Promise<boolean> {
    const result = await this.db
      .updateTable('oauth_code')
      .set({ used_at: at })
      .where('lookup', '=', lookup)
      .where('used_at', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) === 1;
  }

  async insertToken(token: OAuthToken): Promise<void> {
    await this.db
      .insertInto('oauth_token')
      .values({
        lookup: token.lookup,
        secret_hash: token.secretHash,
        kind: token.kind,
        grant_id: token.grantId,
        created_at: token.createdAt,
        expires_at: token.expiresAt,
        used_at: token.usedAt,
      })
      .execute();
  }

  async findToken(lookup: string, kind: TokenKind): Promise<OAuthToken | null> {
    const row = await this.db
      .selectFrom('oauth_token')
      .selectAll()
      .where('lookup', '=', lookup)
      .where('kind', '=', kind)
      .executeTakeFirst();
    if (!row) return null;
    return {
      lookup: row.lookup,
      secretHash: row.secret_hash,
      kind: row.kind as TokenKind,
      grantId: row.grant_id,
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
      usedAt: num(row.used_at),
    };
  }

  async useToken(lookup: string, at: number): Promise<boolean> {
    const result = await this.db
      .updateTable('oauth_token')
      .set({ used_at: at })
      .where('lookup', '=', lookup)
      .where('used_at', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) === 1;
  }

  async prune(before: number): Promise<number> {
    const codes = await this.db.deleteFrom('oauth_code').where('expires_at', '<', before).executeTakeFirst();
    const tokens = await this.db
      .deleteFrom('oauth_token')
      .where('expires_at', '<', before)
      .executeTakeFirst();
    return Number(codes.numDeletedRows) + Number(tokens.numDeletedRows);
  }
}

/** Secrets of codes and tokens: HMAC with a pepper from SECRET_KEY (as for API keys), PKCE S256. */
export class HmacOAuthSecrets implements OAuthSecrets {
  private readonly pepper: Buffer;

  constructor(secretKey: string) {
    this.pepper = Buffer.from(hkdfSync('sha256', secretKey, 'darkbeacon', 'oauth-tokens', 32));
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

  s256(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }
}

const MAX_METADATA_BYTES = 16 * 1024;

/**
 * Reads a Client ID Metadata Document: HTTPS only, public addresses only (checked in the lookup
 * the connection uses, as for webhooks), no redirects, 5 s and 16 KiB at most.
 */
export const httpsClientMetadata: ClientMetadataFetcher = {
  fetch(url: string): Promise<unknown> {
    const target = new URL(url);
    if (target.protocol !== 'https:') return Promise.reject(new Error('the client id must be an https URL'));
    const host = target.hostname.replace(/^\[(.*)\]$/, '$1');
    if (/^[\d.:]+$/.test(host) && !isPublicAddress(host))
      return Promise.reject(new Error('a private address'));
    return new Promise((resolve, reject) => {
      const request = httpsRequest(
        target,
        {
          method: 'GET',
          headers: { accept: 'application/json', 'user-agent': 'Darkbeacon' },
          agent: false,
          lookup: publicOnlyLookup,
          signal: AbortSignal.timeout(5_000),
        },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error(`HTTP ${response.statusCode ?? 0}`));
            return;
          }
          let size = 0;
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_METADATA_BYTES) {
              request.destroy(new Error('the document is too large'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
            } catch {
              reject(new Error('not JSON'));
            }
          });
          response.on('error', reject);
        },
      );
      request.on('error', reject);
      request.end();
    });
  },
};
