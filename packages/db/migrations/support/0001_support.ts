import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * Support (docs/support.md).
 *
 * On the hub: every owner seen per character (`support_identities`), the category of tickets kept
 * in PostHog (`support_ticket_notes`), unread handles as hashes (`support_handles`), and, when the
 * hub keeps tickets itself, the tickets, their messages and feedback.
 *
 * On every instance: the unread handle the hub gave an account, sealed (`support_client_handles`).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('support_identities')
    .addColumn('character_id', col.eveId, (c) => c.notNull())
    .addColumn('owner_hash', col.text, (c) => c.notNull())
    .addColumn('generation', col.integer, (c) => c.notNull())
    .addColumn('character_name', col.text, (c) => c.notNull())
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .addColumn('last_seen_at', col.timestamp, (c) => c.notNull())
    .addPrimaryKeyConstraint('support_identities_pk', ['character_id', 'owner_hash'])
    .execute();

  await db.schema
    .createTable('support_ticket_notes')
    .addColumn('ticket_id', col.id, (c) => c.primaryKey())
    .addColumn('distinct_id', col.text, (c) => c.notNull())
    .addColumn('category', col.text, (c) => c.notNull())
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('support_handles')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('token_hash', col.text, (c) => c.notNull().unique())
    .addColumn('distinct_id', col.text, (c) => c.notNull())
    .addColumn('origin', col.text, (c) => c.notNull())
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .addColumn('last_used_at', col.timestamp)
    .execute();
  await db.schema
    .createIndex('support_handles_distinct_id')
    .on('support_handles')
    .column('distinct_id')
    .execute();

  await db.schema
    .createTable('support_tickets')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('number', col.integer, (c) => c.notNull().unique())
    .addColumn('distinct_id', col.text, (c) => c.notNull())
    .addColumn('character_id', col.eveId, (c) => c.notNull())
    .addColumn('character_name', col.text, (c) => c.notNull())
    .addColumn('category', col.text, (c) => c.notNull())
    .addColumn('status', col.text, (c) => c.notNull())
    .addColumn('priority', col.text, (c) => c.notNull())
    .addColumn('context', col.json, (c) => c.notNull())
    .addColumn('preview', col.text)
    .addColumn('message_count', col.integer, (c) => c.notNull())
    .addColumn('unread_customer', col.integer, (c) => c.notNull())
    .addColumn('unread_team', col.integer, (c) => c.notNull())
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .addColumn('last_message_at', col.timestamp)
    .execute();
  await db.schema
    .createIndex('support_tickets_distinct_id')
    .on('support_tickets')
    .column('distinct_id')
    .execute();

  await db.schema
    .createTable('support_messages')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('ticket_id', col.id, (c) => c.notNull())
    .addColumn('author', col.text, (c) => c.notNull())
    .addColumn('author_name', col.text)
    .addColumn('body', col.text, (c) => c.notNull())
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('support_messages_ticket_id')
    .on('support_messages')
    .column('ticket_id')
    .execute();

  await db.schema
    .createTable('support_feedback')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('kind', col.text, (c) => c.notNull())
    .addColumn('rating', col.integer)
    .addColumn('text', col.text, (c) => c.notNull())
    .addColumn('distinct_id', col.text)
    .addColumn('character_id', col.eveId)
    .addColumn('character_name', col.text)
    .addColumn('context', col.json, (c) => c.notNull())
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('support_client_handles')
    .addColumn('account_id', col.id, (c) => c.primaryKey())
    .addColumn('hub_origin', col.text, (c) => c.notNull())
    .addColumn('handle', col.text, (c) => c.notNull())
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    'support_client_handles',
    'support_feedback',
    'support_messages',
    'support_tickets',
    'support_handles',
    'support_ticket_notes',
    'support_identities',
  ])
    await db.schema.dropTable(table).execute();
}
