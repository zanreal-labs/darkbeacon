import { json, type Database } from '@darkbeacon/db';
import type { UserPreferenceRepository } from '@darkbeacon/identity';

interface PreferenceTables {
  user_preference: { account_id: string; area: string; value: string; updated_at: number };
}

export class KyselyUserPreferences implements UserPreferenceRepository {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<PreferenceTables>();
  }

  async list(accountId: string) {
    const rows = await this.db
      .selectFrom('user_preference')
      .selectAll()
      .where('account_id', '=', accountId)
      .orderBy('area')
      .execute();
    return rows.map((r) => ({
      area: r.area,
      value: json.decode<unknown>(r.value),
      updatedAt: Number(r.updated_at),
    }));
  }

  async put(accountId: string, areas: Record<string, unknown>, now: number): Promise<void> {
    await this.database.transaction(async () => {
      for (const [area, value] of Object.entries(areas)) {
        if (value === null || value === undefined) {
          await this.db
            .deleteFrom('user_preference')
            .where('account_id', '=', accountId)
            .where('area', '=', area)
            .execute();
          continue;
        }
        const row = { account_id: accountId, area, value: json.encode(value), updated_at: now };
        await this.db
          .insertInto('user_preference')
          .values(row)
          .onConflict((oc) =>
            oc.columns(['account_id', 'area']).doUpdateSet({ value: row.value, updated_at: now }),
          )
          .execute();
      }
    });
  }
}
