import { bool, json, type Database } from '@darkbeacon/db';
import type {
  BundledPluginMarks,
  InstalledPlugin,
  InstalledTheme,
  PluginManifestSummary,
  PluginRepository,
  ThemeRepository,
} from '@darkbeacon/plugins';

export interface PluginTables {
  plugin: {
    id: string;
    manifest: string;
    enabled: number;
    disabled_map_ids: string;
    failure_count: number;
    error: string | null;
    settings: string;
    map_settings: string;
    installed_at: number;
  };
  plugin_migration: { plugin_id: string; name: string; executed_at: number };
  theme: {
    id: string;
    name: string;
    version: string;
    color_scheme: string;
    extends: string;
    tokens: string;
    installed_at: number;
  };
  theme_choice: { scope: string; theme_id: string };
  plugin_bundled: { id: string; seen_at: number };
}

/** Bundled plugins this instance has seen (installed at least once). */
export class KyselyBundledPluginMarks implements BundledPluginMarks {
  constructor(private readonly database: Database) {}

  async seen(id: string): Promise<boolean> {
    const row = await this.database
      .db<PluginTables>()
      .selectFrom('plugin_bundled')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst();
    return row !== undefined;
  }

  async mark(id: string, at: number): Promise<void> {
    await this.database
      .db<PluginTables>()
      .insertInto('plugin_bundled')
      .values({ id, seen_at: at })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
  }
}

type PluginRow = PluginTables['plugin'];
type ThemeRow = PluginTables['theme'];

export class KyselyPluginRepository implements PluginRepository {
  constructor(private readonly database: Database) {}

  async list(): Promise<InstalledPlugin[]> {
    const rows = await this.database
      .db<PluginTables>()
      .selectFrom('plugin')
      .selectAll()
      .orderBy('id')
      .execute();
    return rows.map(fromPluginRow);
  }

  async findById(id: string): Promise<InstalledPlugin | null> {
    const row = await this.database
      .db<PluginTables>()
      .selectFrom('plugin')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? fromPluginRow(row) : null;
  }

  async save(plugin: InstalledPlugin): Promise<void> {
    const row = toPluginRow(plugin);
    await this.database
      .db<PluginTables>()
      .insertInto('plugin')
      .values(row)
      .onConflict((oc) => oc.column('id').doUpdateSet(row))
      .execute();
  }

  async delete(id: string): Promise<void> {
    await this.database.db<PluginTables>().deleteFrom('plugin').where('id', '=', id).execute();
  }
}

export class KyselyThemeRepository implements ThemeRepository {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<PluginTables>();
  }

  async list(): Promise<InstalledTheme[]> {
    return (await this.db.selectFrom('theme').selectAll().orderBy('name').execute()).map(fromThemeRow);
  }

  async findById(id: string): Promise<InstalledTheme | null> {
    const row = await this.db.selectFrom('theme').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? fromThemeRow(row) : null;
  }

  async save(theme: InstalledTheme): Promise<void> {
    const row: ThemeRow = {
      id: theme.id,
      name: theme.name,
      version: theme.version,
      color_scheme: theme.colorScheme,
      extends: theme.extends,
      tokens: json.encode(theme.tokens),
      installed_at: theme.installedAt,
    };
    await this.db
      .insertInto('theme')
      .values(row)
      .onConflict((oc) => oc.column('id').doUpdateSet(row))
      .execute();
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('theme').where('id', '=', id).execute();
  }

  async getChoice(scope: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('theme_choice')
      .select('theme_id')
      .where('scope', '=', scope)
      .executeTakeFirst();
    return row?.theme_id ?? null;
  }

  async setChoice(scope: string, themeId: string | null): Promise<void> {
    if (themeId === null) {
      await this.db.deleteFrom('theme_choice').where('scope', '=', scope).execute();
      return;
    }
    await this.db
      .insertInto('theme_choice')
      .values({ scope, theme_id: themeId })
      .onConflict((oc) => oc.column('scope').doUpdateSet({ theme_id: themeId }))
      .execute();
  }

  async clearChoicesOf(themeId: string): Promise<void> {
    await this.db.deleteFrom('theme_choice').where('theme_id', '=', themeId).execute();
  }
}

function toPluginRow(p: InstalledPlugin): PluginRow {
  return {
    id: p.id,
    manifest: json.encode(p.manifest),
    enabled: bool.encode(p.enabled),
    disabled_map_ids: json.encode(p.disabledMapIds),
    failure_count: p.failureCount,
    error: p.error,
    settings: json.encode(p.settings),
    map_settings: json.encode(p.mapSettings),
    installed_at: p.installedAt,
  };
}

function fromPluginRow(r: PluginRow): InstalledPlugin {
  return {
    id: r.id,
    manifest: json.decode<PluginManifestSummary>(r.manifest)!,
    enabled: bool.decode(r.enabled),
    disabledMapIds: json.decode<string[]>(r.disabled_map_ids) ?? [],
    failureCount: Number(r.failure_count),
    error: r.error,
    settings: json.decode<Record<string, unknown>>(r.settings) ?? {},
    mapSettings: json.decode<Record<string, Record<string, unknown>>>(r.map_settings) ?? {},
    installedAt: Number(r.installed_at),
  };
}

function fromThemeRow(r: ThemeRow): InstalledTheme {
  return {
    id: r.id,
    name: r.name,
    version: r.version,
    colorScheme: r.color_scheme === 'dark' ? 'dark' : 'light',
    extends: r.extends,
    tokens: json.decode<Record<string, string>>(r.tokens) ?? {},
    installedAt: Number(r.installed_at),
  };
}
