import type { Database } from '@darkbeacon/db';
import { SupportCategory } from '@darkbeacon/shared';
import type {
  ClientHandleStore,
  StoredHandle,
  SupportHandleStore,
  SupportIdentityRecord,
  SupportIdentityStore,
  TicketNotes,
} from '@darkbeacon/support';
import type { SecretBox } from '../identity/secret-box.js';

export interface SupportStoreTables {
  support_identities: {
    character_id: number;
    owner_hash: string;
    generation: number;
    character_name: string;
    created_at: number;
    last_seen_at: number;
  };
  support_ticket_notes: { ticket_id: string; distinct_id: string; category: string; created_at: number };
  support_handles: {
    id: string;
    token_hash: string;
    account_id: string;
    origin: string;
    created_at: number;
    last_used_at: number | null;
  };
  support_client_handles: { account_id: string; hub_origin: string; handle: string; created_at: number };
}

/** Every owner the hub has seen per character. */
export class KyselySupportIdentities implements SupportIdentityStore {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<SupportStoreTables>();
  }

  async ofCharacter(characterId: number): Promise<SupportIdentityRecord[]> {
    const rows = await this.db
      .selectFrom('support_identities')
      .selectAll()
      .where('character_id', '=', characterId)
      .execute();
    return rows.map((r) => ({
      characterId: Number(r.character_id),
      ownerHash: r.owner_hash,
      generation: Number(r.generation),
      characterName: r.character_name,
    }));
  }

  async save(record: SupportIdentityRecord, at: number): Promise<void> {
    await this.db
      .insertInto('support_identities')
      .values({
        character_id: record.characterId,
        owner_hash: record.ownerHash,
        generation: record.generation,
        character_name: record.characterName,
        created_at: at,
        last_seen_at: at,
      })
      .onConflict((oc) =>
        oc
          .columns(['character_id', 'owner_hash'])
          .doUpdateSet({ character_name: record.characterName, last_seen_at: at }),
      )
      .execute();
  }
}

/** The category of tickets a desk does not keep itself. */
export class KyselyTicketNotes implements TicketNotes {
  constructor(private readonly database: Database) {}

  async save(
    ticketId: string,
    note: { distinctId: string; category: SupportCategory; createdAt: number },
  ): Promise<void> {
    await this.database
      .db<SupportStoreTables>()
      .insertInto('support_ticket_notes')
      .values({
        ticket_id: ticketId,
        distinct_id: note.distinctId,
        category: note.category,
        created_at: note.createdAt,
      })
      .onConflict((oc) => oc.column('ticket_id').doNothing())
      .execute();
  }

  async categories(ticketIds: readonly string[]): Promise<Map<string, SupportCategory>> {
    if (ticketIds.length === 0) return new Map();
    const rows = await this.database
      .db<SupportStoreTables>()
      .selectFrom('support_ticket_notes')
      .select(['ticket_id', 'category'])
      .where('ticket_id', 'in', [...ticketIds])
      .execute();
    const out = new Map<string, SupportCategory>();
    for (const row of rows) {
      const category = SupportCategory.safeParse(row.category);
      if (category.success) out.set(row.ticket_id, category.data);
    }
    return out;
  }
}

/** Unread handles of hub accounts, by the SHA-256 of the token. Revoking deletes the row. */
export class KyselySupportHandles implements SupportHandleStore {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<SupportStoreTables>();
  }

  async create(handle: StoredHandle & { tokenHash: string }): Promise<void> {
    await this.db
      .insertInto('support_handles')
      .values({
        id: handle.id,
        token_hash: handle.tokenHash,
        account_id: handle.accountId,
        origin: handle.origin,
        created_at: handle.createdAt,
        last_used_at: handle.lastUsedAt,
      })
      .execute();
  }

  async byTokenHash(tokenHash: string): Promise<StoredHandle | null> {
    const row = await this.db
      .selectFrom('support_handles')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();
    return row ? toHandle(row) : null;
  }

  async ofAccount(accountId: string): Promise<StoredHandle[]> {
    const rows = await this.db
      .selectFrom('support_handles')
      .selectAll()
      .where('account_id', '=', accountId)
      .execute();
    return rows.map(toHandle);
  }

  async revoke(accountId: string, id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('support_handles')
      .where('id', '=', id)
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }

  async touch(id: string, at: number): Promise<void> {
    await this.db.updateTable('support_handles').set({ last_used_at: at }).where('id', '=', id).execute();
  }
}

function toHandle(row: SupportStoreTables['support_handles']): StoredHandle {
  return {
    id: row.id,
    accountId: row.account_id,
    origin: row.origin,
    createdAt: Number(row.created_at),
    lastUsedAt: row.last_used_at === null ? null : Number(row.last_used_at),
  };
}

/** Instance side: each account's handle from the hub, sealed (it is a bearer string). */
export class KyselyClientHandles implements ClientHandleStore {
  constructor(
    private readonly database: Database,
    private readonly box: SecretBox,
  ) {}

  private get db() {
    return this.database.db<SupportStoreTables>();
  }

  async get(accountId: string): Promise<{ hubOrigin: string; handle: string } | null> {
    const row = await this.db
      .selectFrom('support_client_handles')
      .selectAll()
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    const handle = row ? this.box.open(row.handle) : null;
    return row && handle ? { hubOrigin: row.hub_origin, handle } : null;
  }

  async set(accountId: string, value: { hubOrigin: string; handle: string }, at: number): Promise<void> {
    const sealed = this.box.seal(value.handle);
    await this.db
      .insertInto('support_client_handles')
      .values({ account_id: accountId, hub_origin: value.hubOrigin, handle: sealed, created_at: at })
      .onConflict((oc) =>
        oc.column('account_id').doUpdateSet({ hub_origin: value.hubOrigin, handle: sealed, created_at: at }),
      )
      .execute();
  }

  async clear(accountId: string): Promise<void> {
    await this.db.deleteFrom('support_client_handles').where('account_id', '=', accountId).execute();
  }
}
