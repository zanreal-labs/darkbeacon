import type {
  AccessRule,
  AccessRuleRepository,
  InstanceSettings,
  InstanceSettingsRepository,
} from '@wormwright/access';
import type { MapRole } from '@wormwright/core';
import { json, type Database } from '@wormwright/db';
import type { AccessSubjectKind } from '@wormwright/shared';

export interface AccessTables {
  access_rule: {
    id: string;
    map_id: string;
    subject_kind: string;
    subject_id: string;
    guild_id: string | null;
    role: string;
    created_at: number;
    created_by: string;
  };
  instance_setting: { key: string; value: string };
}

type RuleRow = AccessTables['access_rule'];

function toRule(row: RuleRow): AccessRule {
  return {
    id: row.id,
    mapId: row.map_id,
    subjectKind: row.subject_kind as AccessSubjectKind,
    subjectId: row.subject_id,
    guildId: row.guild_id,
    role: row.role as MapRole,
    createdAt: Number(row.created_at),
    createdBy: row.created_by,
  };
}

export class KyselyAccessRuleRepository implements AccessRuleRepository {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<AccessTables>();
  }

  async listForMap(mapId: string): Promise<AccessRule[]> {
    const rows = await this.db
      .selectFrom('access_rule')
      .selectAll()
      .where('map_id', '=', mapId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map(toRule);
  }

  async findById(ruleId: string): Promise<AccessRule | null> {
    const row = await this.db
      .selectFrom('access_rule')
      .selectAll()
      .where('id', '=', ruleId)
      .executeTakeFirst();
    return row ? toRule(row) : null;
  }

  async insert(rule: AccessRule): Promise<void> {
    await this.db
      .insertInto('access_rule')
      .values({
        id: rule.id,
        map_id: rule.mapId,
        subject_kind: rule.subjectKind,
        subject_id: rule.subjectId,
        guild_id: rule.guildId,
        role: rule.role,
        created_at: rule.createdAt,
        created_by: rule.createdBy,
      })
      .execute();
  }

  async delete(ruleId: string): Promise<void> {
    await this.db.deleteFrom('access_rule').where('id', '=', ruleId).execute();
  }

  async listMatching(subjects: { kind: AccessSubjectKind; id: string }[]): Promise<AccessRule[]> {
    if (subjects.length === 0) return [];
    const byKind = new Map<string, string[]>();
    for (const { kind, id } of subjects) byKind.set(kind, [...(byKind.get(kind) ?? []), id]);
    const rows = await this.db
      .selectFrom('access_rule')
      .selectAll()
      .where((eb) =>
        eb.or(
          [...byKind].map(([kind, ids]) =>
            eb.and([eb('subject_kind', '=', kind), eb('subject_id', 'in', ids)]),
          ),
        ),
      )
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map(toRule);
  }

  async discordGuildIds(): Promise<string[]> {
    const rows = await this.db
      .selectFrom('access_rule')
      .select('guild_id')
      .distinct()
      .where('subject_kind', '=', 'discordRole')
      .where('guild_id', 'is not', null)
      .execute();
    return rows.map((r) => r.guild_id!).sort();
  }
}

/** One row per setting, the value as JSON. */
export class KyselyInstanceSettingsRepository implements InstanceSettingsRepository {
  constructor(private readonly database: Database) {}

  async load(): Promise<Partial<InstanceSettings>> {
    const rows = await this.database.db<AccessTables>().selectFrom('instance_setting').selectAll().execute();
    return Object.fromEntries(rows.map((r) => [r.key, json.decode(r.value)])) as Partial<InstanceSettings>;
  }

  async save(settings: Partial<InstanceSettings>): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      if (value === undefined) continue;
      await this.database
        .db<AccessTables>()
        .insertInto('instance_setting')
        .values({ key, value: json.encode(value) })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value: json.encode(value) }))
        .execute();
    }
  }
}
