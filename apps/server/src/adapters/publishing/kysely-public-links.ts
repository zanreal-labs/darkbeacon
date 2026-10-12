import { randomInt } from 'node:crypto';
import { bool, json, type Database } from '@darkbeacon/db';
import type { PublicLink, PublicLinkRepository, LinkSecrets } from '@darkbeacon/publishing';
import type { McpMode, ShareScope } from '@darkbeacon/shared';

export interface PublishingTables {
  public_link: {
    map_id: string;
    enabled: number;
    token: string | null;
    slug: string | null;
    scopes: string;
    noindex: number;
    mcp_mode: string;
    updated_at: number | null;
    updated_by: string | null;
  };
}

type Row = PublishingTables['public_link'];

function toShare(row: Row): PublicLink {
  return {
    mapId: row.map_id,
    enabled: bool.decode(row.enabled),
    token: row.token,
    slug: row.slug,
    scopes: json.decode<ShareScope[]>(row.scopes) ?? ['topology'],
    noindex: bool.decode(row.noindex),
    mcpMode: row.mcp_mode as McpMode,
    updatedAt: row.updated_at === null ? null : Number(row.updated_at),
    updatedBy: row.updated_by,
  };
}

export class KyselyPublicLinkRepository implements PublicLinkRepository {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<PublishingTables>();
  }

  async find(mapId: string): Promise<PublicLink | null> {
    const row = await this.db
      .selectFrom('public_link')
      .selectAll()
      .where('map_id', '=', mapId)
      .executeTakeFirst();
    return row ? toShare(row) : null;
  }

  async findByToken(token: string): Promise<PublicLink | null> {
    const row = await this.db
      .selectFrom('public_link')
      .selectAll()
      .where('token', '=', token)
      .executeTakeFirst();
    return row ? toShare(row) : null;
  }

  async findBySlug(slug: string): Promise<PublicLink | null> {
    const row = await this.db
      .selectFrom('public_link')
      .selectAll()
      .where('slug', '=', slug)
      .executeTakeFirst();
    return row ? toShare(row) : null;
  }

  async listEnabled(): Promise<PublicLink[]> {
    const rows = await this.db
      .selectFrom('public_link')
      .selectAll()
      .where('enabled', '=', 1)
      .orderBy('map_id')
      .execute();
    return rows.map(toShare);
  }

  async save(share: PublicLink): Promise<void> {
    const row: Row = {
      map_id: share.mapId,
      enabled: bool.encode(share.enabled),
      token: share.token,
      slug: share.slug,
      scopes: json.encode(share.scopes),
      noindex: bool.encode(share.noindex),
      mcp_mode: share.mcpMode,
      updated_at: share.updatedAt,
      updated_by: share.updatedBy,
    };
    const { map_id: _id, ...rest } = row;
    await this.db
      .insertInto('public_link')
      .values(row)
      .onConflict((oc) => oc.column('map_id').doUpdateSet(rest))
      .execute();
  }

  async delete(mapId: string): Promise<void> {
    await this.db.deleteFrom('public_link').where('map_id', '=', mapId).execute();
  }
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Link tokens from the CSPRNG. */
export const cryptoLinkSecrets: LinkSecrets = {
  random(length) {
    let out = '';
    for (let i = 0; i < length; i++) out += BASE62[randomInt(62)];
    return out;
  },
};
