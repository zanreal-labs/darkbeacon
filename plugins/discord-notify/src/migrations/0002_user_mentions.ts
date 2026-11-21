// Way-home watches mention the one member who set the watch: the outbox keeps that Discord user
// per message (null for every other kind).
import type { PluginMigration } from '@darkbeacon/plugin-sdk';

type Db = Parameters<PluginMigration['up']>[0];

export async function up(db: Db): Promise<void> {
  await db.schema.alterTable('discord_notify_outbox').addColumn('mention_user', 'text').execute();
}
