import { sql } from 'kysely';
import type { InstanceRole } from '@darkbeacon/core';
import { bool, json, type Database } from '@darkbeacon/db';
import type {
  Account,
  AccountRepository,
  CharacterRepository,
  CharacterTokens,
  DiscordBotStore,
  DiscordBotUser,
  DiscordLink,
  DiscordLinkRepository,
  GuildRole,
  Invite,
  InviteRepository,
  LinkedCharacter,
  Session,
  SessionRepository,
} from '@darkbeacon/identity';
import type { SecretBox } from './secret-box.js';

export interface IdentityTables {
  account: {
    id: string;
    discord_id: string | null;
    name: string;
    avatar_url: string | null;
    instance_role: string;
    main_character_id: number | null;
    default_map_id: string | null;
    recent_map_ids: string | null;
    created_at: number;
    updated_at: number;
    last_seen_at: number | null;
    disabled_at: number | null;
    disabled_reason: string | null;
  };
  invite: {
    id: string;
    token_hash: string;
    note: string | null;
    created_by: string;
    created_at: number;
    expires_at: number | null;
    max_uses: number | null;
    uses: number;
    revoked_at: number | null;
  };
  session: {
    id: string;
    account_id: string;
    created_at: number;
    expires_at: number;
    last_seen_at: number;
    user_agent: string | null;
  };
  discord_link: {
    account_id: string;
    access_token: string;
    refresh_token: string;
    expires_at: number;
    guild_roles: string;
    roles_checked_at: number | null;
  };
  eve_character: {
    id: number;
    account_id: string;
    name: string;
    corporation_id: number;
    alliance_id: number | null;
    owner_hash: string;
    token_valid: number;
    linked_at: number;
    updated_at: number;
  };
  eve_character_token: {
    character_id: number;
    access_token: string;
    refresh_token: string;
    expires_at: number;
    scopes: string;
  };
  discord_bot: {
    id: string;
    token: string;
    user_id: string;
    name: string;
    avatar_url: string | null;
    error: string | null;
    updated_at: number;
  };
}

type AccountRow = IdentityTables['account'];

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    discordId: row.discord_id,
    name: row.name,
    avatarUrl: row.avatar_url,
    instanceRole: row.instance_role as InstanceRole,
    mainCharacterId: row.main_character_id === null ? null : Number(row.main_character_id),
    defaultMapId: row.default_map_id,
    recentMapIds: json.decode<string[]>(row.recent_map_ids) ?? [],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastSeenAt: row.last_seen_at === null ? null : Number(row.last_seen_at),
    disabledAt: row.disabled_at === null || row.disabled_at === undefined ? null : Number(row.disabled_at),
    disabledReason: row.disabled_reason ?? null,
  };
}

function fromAccount(a: Account): AccountRow {
  return {
    id: a.id,
    discord_id: a.discordId,
    name: a.name,
    avatar_url: a.avatarUrl,
    instance_role: a.instanceRole,
    main_character_id: a.mainCharacterId ?? null,
    default_map_id: a.defaultMapId ?? null,
    recent_map_ids: json.encode(a.recentMapIds ?? []),
    created_at: a.createdAt,
    updated_at: a.updatedAt,
    last_seen_at: a.lastSeenAt,
    disabled_at: a.disabledAt ?? null,
    disabled_reason: a.disabledReason ?? null,
  };
}

export class KyselyAccountRepository implements AccountRepository {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<IdentityTables>();
  }

  async findById(id: string): Promise<Account | null> {
    const row = await this.db.selectFrom('account').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? toAccount(row) : null;
  }

  async findByDiscordId(discordId: string): Promise<Account | null> {
    const row = await this.db
      .selectFrom('account')
      .selectAll()
      .where('discord_id', '=', discordId)
      .executeTakeFirst();
    return row ? toAccount(row) : null;
  }

  async findByName(name: string): Promise<Account | null> {
    const row = await this.db
      .selectFrom('account')
      .selectAll()
      .where('name', '=', name)
      .where('discord_id', 'is', null)
      .orderBy('created_at')
      .executeTakeFirst();
    return row ? toAccount(row) : null;
  }

  async list(): Promise<Account[]> {
    const rows = await this.db
      .selectFrom('account')
      .selectAll()
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map(toAccount);
  }

  async count(): Promise<number> {
    const row = await this.db
      .selectFrom('account')
      .select((eb) => eb.fn.countAll<number | string>().as('n'))
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async insert(account: Account): Promise<void> {
    await this.db.insertInto('account').values(fromAccount(account)).execute();
  }

  async update(account: Account): Promise<void> {
    const { id, ...row } = fromAccount(account);
    await this.db.updateTable('account').set(row).where('id', '=', id).execute();
  }

  async touch(id: string, lastSeenAt: number): Promise<void> {
    await this.db.updateTable('account').set({ last_seen_at: lastSeenAt }).where('id', '=', id).execute();
  }

  async setRecentMaps(id: string, recentMapIds: string[]): Promise<void> {
    await this.db
      .updateTable('account')
      .set({ recent_map_ids: json.encode(recentMapIds) })
      .where('id', '=', id)
      .execute();
  }

  async search(text: string, limit: number): Promise<Account[]> {
    const needle = text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
    const rows = await this.db
      .selectFrom('account')
      .selectAll()
      .where(sql<boolean>`lower(name) like ${`%${needle}%`} escape '\\'`)
      .orderBy('name')
      .limit(limit * 4)
      .execute();
    const t = text.toLowerCase();
    return rows
      .map(toAccount)
      .sort(
        (a, b) =>
          Number(!a.name.toLowerCase().startsWith(t)) - Number(!b.name.toLowerCase().startsWith(t)) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, limit);
  }
}

export class KyselySessionRepository implements SessionRepository {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<IdentityTables>();
  }

  async insert(s: Session): Promise<void> {
    await this.db
      .insertInto('session')
      .values({
        id: s.id,
        account_id: s.accountId,
        created_at: s.createdAt,
        expires_at: s.expiresAt,
        last_seen_at: s.lastSeenAt,
        user_agent: s.userAgent,
      })
      .execute();
  }

  async findById(id: string): Promise<Session | null> {
    const row = await this.db.selectFrom('session').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      accountId: row.account_id,
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
      lastSeenAt: Number(row.last_seen_at),
      userAgent: row.user_agent,
    };
  }

  async listForAccount(accountId: string): Promise<Session[]> {
    const rows = await this.db
      .selectFrom('session')
      .selectAll()
      .where('account_id', '=', accountId)
      .orderBy('last_seen_at', 'desc')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
      lastSeenAt: Number(row.last_seen_at),
      userAgent: row.user_agent,
    }));
  }

  async touch(id: string, lastSeenAt: number, expiresAt: number): Promise<void> {
    await this.db
      .updateTable('session')
      .set({ last_seen_at: lastSeenAt, expires_at: expiresAt })
      .where('id', '=', id)
      .execute();
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('session').where('id', '=', id).execute();
  }

  async deleteForAccount(accountId: string): Promise<number> {
    const result = await this.db.deleteFrom('session').where('account_id', '=', accountId).executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  async deleteExpired(now: number): Promise<number> {
    const result = await this.db.deleteFrom('session').where('expires_at', '<=', now).executeTakeFirst();
    return Number(result.numDeletedRows);
  }
}

/** Discord grants; tokens are sealed with the `discord-tokens` key. */
export class KyselyDiscordLinkRepository implements DiscordLinkRepository {
  constructor(
    private readonly database: Database,
    private readonly box: SecretBox,
  ) {}

  async find(accountId: string): Promise<DiscordLink | null> {
    const row = await this.database
      .db<IdentityTables>()
      .selectFrom('discord_link')
      .selectAll()
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      accountId: row.account_id,
      accessToken: this.box.openOrThrow(row.access_token),
      refreshToken: this.box.openOrThrow(row.refresh_token),
      expiresAt: Number(row.expires_at),
      guildRoles: json.decode<GuildRole[]>(row.guild_roles) ?? [],
      rolesCheckedAt: row.roles_checked_at === null ? null : Number(row.roles_checked_at),
    };
  }

  async save(link: DiscordLink): Promise<void> {
    const row = {
      account_id: link.accountId,
      access_token: this.box.seal(link.accessToken),
      refresh_token: this.box.seal(link.refreshToken),
      expires_at: link.expiresAt,
      guild_roles: json.encode(link.guildRoles),
      roles_checked_at: link.rolesCheckedAt,
    };
    const { account_id: _, ...update } = row;
    await this.database
      .db<IdentityTables>()
      .insertInto('discord_link')
      .values(row)
      .onConflict((oc) => oc.column('account_id').doUpdateSet(update))
      .execute();
  }

  async remove(accountId: string): Promise<void> {
    await this.database
      .db<IdentityTables>()
      .deleteFrom('discord_link')
      .where('account_id', '=', accountId)
      .execute();
  }
}

/** The instance's Discord bot; its token is sealed with the `discord-bot` key. */
export class KyselyDiscordBotStore implements DiscordBotStore {
  constructor(
    private readonly database: Database,
    private readonly box: SecretBox,
  ) {}

  private get db() {
    return this.database.db<IdentityTables>();
  }

  async load(): Promise<{ token: string; user: DiscordBotUser; error: string | null } | null> {
    const row = await this.db
      .selectFrom('discord_bot')
      .selectAll()
      .where('id', '=', 'instance')
      .executeTakeFirst();
    if (!row) return null;
    const token = this.box.open(row.token);
    if (!token) return null;
    return {
      token,
      user: { id: row.user_id, name: row.name, avatarUrl: row.avatar_url },
      error: row.error,
    };
  }

  async save(bot: { token: string; user: DiscordBotUser; error: string | null }): Promise<void> {
    const row = {
      id: 'instance',
      token: this.box.seal(bot.token),
      user_id: bot.user.id,
      name: bot.user.name,
      avatar_url: bot.user.avatarUrl,
      error: bot.error,
      updated_at: Date.now(),
    };
    const { id: _, ...update } = row;
    await this.db
      .insertInto('discord_bot')
      .values(row)
      .onConflict((oc) => oc.column('id').doUpdateSet(update))
      .execute();
  }

  async clear(): Promise<void> {
    await this.db.deleteFrom('discord_bot').execute();
  }
}

type CharacterRow = IdentityTables['eve_character'];

function toCharacter(row: CharacterRow): LinkedCharacter {
  return {
    id: Number(row.id),
    accountId: row.account_id,
    name: row.name,
    corporationId: Number(row.corporation_id),
    allianceId: row.alliance_id === null ? null : Number(row.alliance_id),
    ownerHash: row.owner_hash,
    tokenValid: bool.decode(row.token_valid),
    linkedAt: Number(row.linked_at),
    updatedAt: Number(row.updated_at),
  };
}

/** EVE characters; ESI tokens are sealed with the `eve-tokens` key. */
export class KyselyCharacterRepository implements CharacterRepository {
  constructor(
    private readonly database: Database,
    private readonly box: SecretBox,
  ) {}

  private get db() {
    return this.database.db<IdentityTables>();
  }

  async findById(characterId: number): Promise<LinkedCharacter | null> {
    const row = await this.db
      .selectFrom('eve_character')
      .selectAll()
      .where('id', '=', characterId)
      .executeTakeFirst();
    return row ? toCharacter(row) : null;
  }

  async findMany(characterIds: readonly number[]): Promise<LinkedCharacter[]> {
    if (characterIds.length === 0) return [];
    const found: LinkedCharacter[] = [];
    // Kept well below the bound-parameter limits of both dialects.
    for (let i = 0; i < characterIds.length; i += 500) {
      const rows = await this.db
        .selectFrom('eve_character')
        .selectAll()
        .where('id', 'in', [...characterIds.slice(i, i + 500)])
        .execute();
      found.push(...rows.map(toCharacter));
    }
    return found;
  }

  async listAll(): Promise<LinkedCharacter[]> {
    const rows = await this.db.selectFrom('eve_character').selectAll().orderBy('name').execute();
    return rows.map(toCharacter);
  }

  async listForAccount(accountId: string): Promise<LinkedCharacter[]> {
    const rows = await this.db
      .selectFrom('eve_character')
      .selectAll()
      .where('account_id', '=', accountId)
      .orderBy('linked_at')
      .orderBy('id')
      .execute();
    return rows.map(toCharacter);
  }

  async upsert(c: LinkedCharacter): Promise<void> {
    const row: CharacterRow = {
      id: c.id,
      account_id: c.accountId,
      name: c.name,
      corporation_id: c.corporationId,
      alliance_id: c.allianceId,
      owner_hash: c.ownerHash,
      token_valid: bool.encode(c.tokenValid),
      linked_at: c.linkedAt,
      updated_at: c.updatedAt,
    };
    const { id: _, ...update } = row;
    await this.db
      .insertInto('eve_character')
      .values(row)
      .onConflict((oc) => oc.column('id').doUpdateSet(update))
      .execute();
  }

  async updateState(
    characterId: number,
    accountId: string,
    state: Partial<Pick<LinkedCharacter, 'corporationId' | 'allianceId' | 'tokenValid'>> & {
      updatedAt: number;
    },
  ): Promise<boolean> {
    const result = await this.db
      .updateTable('eve_character')
      .set({
        ...(state.corporationId !== undefined ? { corporation_id: state.corporationId } : {}),
        ...(state.allianceId !== undefined ? { alliance_id: state.allianceId } : {}),
        ...(state.tokenValid !== undefined ? { token_valid: bool.encode(state.tokenValid) } : {}),
        updated_at: state.updatedAt,
      })
      .where('id', '=', characterId)
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  }

  async delete(characterId: number): Promise<void> {
    await this.db.deleteFrom('eve_character_token').where('character_id', '=', characterId).execute();
    await this.db.deleteFrom('eve_character').where('id', '=', characterId).execute();
  }

  async saveTokens(characterId: number, tokens: CharacterTokens): Promise<void> {
    const row = {
      character_id: characterId,
      access_token: this.box.seal(tokens.accessToken),
      refresh_token: this.box.seal(tokens.refreshToken),
      expires_at: tokens.expiresAt,
      scopes: json.encode(tokens.scopes),
    };
    const { character_id: _, ...update } = row;
    await this.db
      .insertInto('eve_character_token')
      .values(row)
      .onConflict((oc) => oc.column('character_id').doUpdateSet(update))
      .execute();
  }

  async getTokens(characterId: number): Promise<CharacterTokens | null> {
    const row = await this.db
      .selectFrom('eve_character_token')
      .selectAll()
      .where('character_id', '=', characterId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      accessToken: this.box.openOrThrow(row.access_token),
      refreshToken: this.box.openOrThrow(row.refresh_token),
      expiresAt: Number(row.expires_at),
      scopes: json.decode<string[]>(row.scopes) ?? [],
    };
  }

  async scopesOf(characterIds: readonly number[]): Promise<Map<number, string[]>> {
    if (characterIds.length === 0) return new Map();
    const rows = await this.db
      .selectFrom('eve_character_token')
      .select(['character_id', 'scopes'])
      .where('character_id', 'in', [...characterIds])
      .execute();
    return new Map(rows.map((r) => [Number(r.character_id), json.decode<string[]>(r.scopes) ?? []]));
  }
}

type InviteRow = IdentityTables['invite'];

function toInvite(row: InviteRow): Invite {
  const n = (v: number | null) => (v === null ? null : Number(v));
  return {
    id: row.id,
    tokenHash: row.token_hash,
    note: row.note,
    createdBy: row.created_by,
    createdAt: Number(row.created_at),
    expiresAt: n(row.expires_at),
    maxUses: n(row.max_uses),
    uses: Number(row.uses),
    revokedAt: n(row.revoked_at),
  };
}

export class KyselyInviteRepository implements InviteRepository {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<IdentityTables>();
  }

  async insert(invite: Invite): Promise<void> {
    await this.db
      .insertInto('invite')
      .values({
        id: invite.id,
        token_hash: invite.tokenHash,
        note: invite.note,
        created_by: invite.createdBy,
        created_at: invite.createdAt,
        expires_at: invite.expiresAt,
        max_uses: invite.maxUses,
        uses: invite.uses,
        revoked_at: invite.revokedAt,
      })
      .execute();
  }

  async list(): Promise<Invite[]> {
    const rows = await this.db.selectFrom('invite').selectAll().orderBy('created_at', 'desc').execute();
    return rows.map(toInvite);
  }

  async findById(id: string): Promise<Invite | null> {
    const row = await this.db.selectFrom('invite').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? toInvite(row) : null;
  }

  async findByTokenHash(hash: string): Promise<Invite | null> {
    const row = await this.db
      .selectFrom('invite')
      .selectAll()
      .where('token_hash', '=', hash)
      .executeTakeFirst();
    return row ? toInvite(row) : null;
  }

  async update(invite: Invite): Promise<void> {
    await this.db
      .updateTable('invite')
      .set({ note: invite.note, uses: invite.uses, revoked_at: invite.revokedAt })
      .where('id', '=', invite.id)
      .execute();
  }

  async use(id: string, now: number): Promise<boolean> {
    const result = await this.db
      .updateTable('invite')
      .set((eb) => ({ uses: eb('uses', '+', 1) }))
      .where('id', '=', id)
      .where('revoked_at', 'is', null)
      .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', now)]))
      .where((eb) => eb.or([eb('max_uses', 'is', null), eb('uses', '<', eb.ref('max_uses'))]))
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  }
}
