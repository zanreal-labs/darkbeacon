import type { InstanceRole } from '@wormwright/core';
import { bool, json, type Database } from '@wormwright/db';
import type {
  Account,
  AccountRepository,
  CharacterRepository,
  CharacterTokens,
  DiscordLink,
  DiscordLinkRepository,
  GuildRole,
  LinkedCharacter,
  Session,
  SessionRepository,
} from '@wormwright/identity';
import type { SecretBox } from './secret-box.js';

export interface IdentityTables {
  account: {
    id: string;
    discord_id: string | null;
    name: string;
    avatar_url: string | null;
    instance_role: string;
    main_character_id: number | null;
    created_at: number;
    updated_at: number;
    last_seen_at: number | null;
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
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastSeenAt: row.last_seen_at === null ? null : Number(row.last_seen_at),
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
    created_at: a.createdAt,
    updated_at: a.updatedAt,
    last_seen_at: a.lastSeenAt,
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
}
