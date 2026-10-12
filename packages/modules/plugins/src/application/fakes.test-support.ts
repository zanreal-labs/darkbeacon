import type { DomainEvent, EventLog, NewEvent, UnitOfWork } from '@darkbeacon/core';
import type { InstalledPlugin } from '../domain/plugin.js';
import type { PackageSource } from '../domain/source.js';
import type { InstalledTheme } from '../domain/theme.js';
import type {
  CatalogEntry,
  PluginInstaller,
  PluginRepository,
  PluginSettingsSchemas,
  StagedPackage,
} from '../ports/plugin-repository.js';
import type { ThemeRepository } from '../ports/theme-repository.js';

export class MemoryPlugins implements PluginRepository {
  readonly rows = new Map<string, InstalledPlugin>();
  list = async () => [...this.rows.values()];
  findById = async (id: string) => this.rows.get(id) ?? null;
  save = async (p: InstalledPlugin) => void this.rows.set(p.id, p);
  delete = async (id: string) => void this.rows.delete(id);
}

export class MemoryThemes implements ThemeRepository {
  readonly rows = new Map<string, InstalledTheme>();
  readonly choices = new Map<string, string>();
  list = async () => [...this.rows.values()];
  findById = async (id: string) => this.rows.get(id) ?? null;
  save = async (t: InstalledTheme) => void this.rows.set(t.id, t);
  delete = async (id: string) => void this.rows.delete(id);
  getChoice = async (scope: string) => this.choices.get(scope) ?? null;
  setChoice = async (scope: string, id: string | null) =>
    void (id === null ? this.choices.delete(scope) : this.choices.set(scope, id));
  clearChoicesOf = async (id: string) => {
    for (const [scope, theme] of this.choices) if (theme === id) this.choices.delete(scope);
  };
}

/** Stages whatever `next` holds and records what happened to it. */
export class FakeInstaller implements PluginInstaller {
  next: StagedPackage | Error | null = null;
  readonly committed: string[] = [];
  readonly discarded: string[] = [];
  readonly removed: string[] = [];
  entries: CatalogEntry[] = [];

  async stage(_source: PackageSource): Promise<StagedPackage> {
    if (this.next instanceof Error) throw this.next;
    if (!this.next) throw new Error('nothing to stage');
    return this.next;
  }
  commit = async (s: StagedPackage) => void this.committed.push(s.directory);
  discard = async (s: StagedPackage) => void this.discarded.push(s.directory);
  remove = async (id: string) => void this.removed.push(id);
  catalog = async () => this.entries;
}

export class FakeSchemas implements PluginSettingsSchemas {
  schemaOf = async (p: InstalledPlugin) => (p.manifest.settings ? { type: 'object' } : null);
  validate = async (_p: InstalledPlugin, values: Record<string, unknown>) =>
    typeof values.url === 'number'
      ? { ok: false as const, errors: [{ path: 'url', message: 'Expected string' }] }
      : { ok: true as const, value: { username: 'Darkbeacon', ...values } };
}

export class MemoryLog implements EventLog {
  readonly events: DomainEvent[] = [];
  append = async (events: readonly NewEvent[]) => {
    const stored = events.map((e) => ({ ...e, seq: this.events.length + 1, v: 1 as const }));
    this.events.push(...stored);
    return stored;
  };
  readSince = async () => [];
  headSeq = async () => this.events.length;
  oldestSeq = async () => null;
  prune = async () => 0;
}

export const directUow: UnitOfWork = { transaction: (work) => work() };
