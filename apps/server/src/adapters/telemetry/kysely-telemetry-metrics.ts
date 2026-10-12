import { sql } from 'kysely';
import type { Database } from '@darkbeacon/db';
import { INSTANCE_THEME_SCOPE } from '@darkbeacon/plugins';
import { countBucket, FIRST_PARTY_PLUGIN_IDS, telemetryThemeId } from '@darkbeacon/shared';
import type { InstanceMetrics, TelemetryMetrics } from '@darkbeacon/telemetry';

const DAY = 24 * 60 * 60 * 1000;

/** What the heartbeat reads from the instance configuration (through other modules' public APIs). */
export interface InstanceFacts {
  loginMethod(): Promise<'discord' | 'eve'>;
  eventRetention(): Promise<boolean>;
}

/**
 * Sizes of the instance, read-only and as counts: never a name, id or anything on a map. A
 * count whose table is missing (a plugin that is not installed) is 0.
 */
export class KyselyTelemetryMetrics implements TelemetryMetrics {
  constructor(
    private readonly database: Database,
    private readonly facts: InstanceFacts,
  ) {}

  async collect(now: number): Promise<InstanceMetrics> {
    const db = this.database.db();
    const n = async (query: ReturnType<typeof sql<{ n: number | string }>>) => {
      try {
        const { rows } = await query.execute(db);
        return Number(rows[0]?.n ?? 0);
      } catch {
        return 0;
      }
    };
    const activeAccounts = (since: number) =>
      n(sql`select count(*) as n from account where last_seen_at >= ${since}`);
    const activeCharacters = (since: number) =>
      n(
        sql`select count(*) as n from eve_character c join account a on a.id = c.account_id where a.last_seen_at >= ${since}`,
      );

    const plugins = await sql<{ id: string; enabled: number | boolean }>`select id, enabled from plugin`
      .execute(db)
      .then((r) => r.rows)
      .catch(() => []);
    const enabled = plugins.filter((p) => p.enabled === 1 || p.enabled === true);
    const firstParty = enabled
      .map((p) => p.id)
      .filter((id): id is (typeof FIRST_PARTY_PLUGIN_IDS)[number] =>
        (FIRST_PARTY_PLUGIN_IDS as readonly string[]).includes(id),
      )
      .sort();
    const themes = await sql<{ id: string }>`select id from theme`
      .execute(db)
      .then((r) => r.rows.map((t) => t.id))
      .catch(() => [] as string[]);
    const defaultTheme = await sql<{
      theme_id: string;
    }>`select theme_id from theme_choice where scope = ${INSTANCE_THEME_SCOPE}`
      .execute(db)
      .then((r) => r.rows[0]?.theme_id ?? 'system')
      .catch(() => 'system');

    return {
      db: this.database.dialect,
      login_method: await this.facts.loginMethod(),
      discord_bot: (await n(sql`select count(*) as n from discord_bot`)) > 0,
      event_retention: await this.facts.eventRetention().catch(() => false),
      plugins_first_party: firstParty,
      plugins_third_party: countBucket(enabled.length - firstParty.length),
      theme_default: telemetryThemeId(defaultTheme),
      themes_third_party: countBucket(themes.filter((id) => telemetryThemeId(id) === 'custom').length),
      accounts: await n(sql`select count(*) as n from account`),
      characters: await n(sql`select count(*) as n from eve_character`),
      maps: await n(sql`select count(*) as n from maps`),
      accounts_dau: await activeAccounts(now - DAY),
      accounts_wau: await activeAccounts(now - 7 * DAY),
      accounts_mau: await activeAccounts(now - 30 * DAY),
      characters_dau: await activeCharacters(now - DAY),
      characters_wau: await activeCharacters(now - 7 * DAY),
      characters_mau: await activeCharacters(now - 30 * DAY),
      systems: countBucket(await n(sql`select count(*) as n from map_systems where visible = 1`)),
      connections: countBucket(await n(sql`select count(*) as n from map_connections`)),
      signatures: countBucket(await n(sql`select count(*) as n from map_signatures`)),
      webhooks: countBucket(await n(sql`select count(*) as n from webhook where enabled = 1`)),
      discord_notify_maps: countBucket(
        await n(sql`select count(*) as n from discord_notify_config where target is not null`),
      ),
    };
  }

  async onlineTrackedCharacters(): Promise<number> {
    try {
      const { rows } = await sql<{ n: number | string }>`
        select count(*) as n from character_presence p
        where p.online = 1 and exists (select 1 from tracked_character t where t.character_id = p.character_id)
      `.execute(this.database.db());
      return Number(rows[0]?.n ?? 0);
    } catch {
      return 0;
    }
  }
}
