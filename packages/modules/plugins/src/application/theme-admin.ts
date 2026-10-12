import {
  NotFoundError,
  ValidationError,
  requireAccount,
  requireInstanceRole,
  type Actor,
} from '@darkbeacon/core';
import type { PackageSource } from '../domain/source.js';
import {
  DEFAULT_THEME_ID,
  INSTANCE_THEME_SCOPE,
  accountThemeScope,
  type InstalledTheme,
} from '../domain/theme.js';
import type { Clock, UnitOfWork } from '../ports/index.js';
import type { PluginInstaller } from '../ports/plugin-repository.js';
import type { ThemeRepository } from '../ports/theme-repository.js';

export interface ThemeAdminDeps {
  themes: ThemeRepository;
  installer: PluginInstaller;
  uow: UnitOfWork;
  clock: Clock;
  /** Ids of the built-in themes (and the `system` preference): valid choices that packages cannot reuse. */
  builtInIds: readonly string[];
}

export interface ThemeOverview {
  installed: InstalledTheme[];
  defaultThemeId: string;
  selectedThemeId: string | null;
}

/** The theme an account's pages start with, for the web app's head script. */
export interface StartingTheme {
  themeId: string;
  /** The account picked it (otherwise it is the instance default). */
  own: boolean;
  /** Set for a theme package: its colour scheme. */
  packageScheme: 'light' | 'dark' | null;
}

/** Theme packages, the instance default and each account's own choice. */
export class ThemeAdmin {
  constructor(private readonly deps: ThemeAdminDeps) {}

  /** Open to anyone, so the sign-in page is themed too; `selectedThemeId` needs an account. */
  async overview(actor: Actor | null): Promise<ThemeOverview> {
    const installed = await this.deps.themes.list();
    const known = (id: string | null) => (id !== null && this.exists(id, installed) ? id : null);
    const defaultThemeId = known(await this.deps.themes.getChoice(INSTANCE_THEME_SCOPE)) ?? DEFAULT_THEME_ID;
    const selectedThemeId =
      actor?.kind === 'account' ? known(await this.deps.themes.getChoice(accountThemeScope(actor.id))) : null;
    return { installed, defaultThemeId, selectedThemeId };
  }

  /** The account's own choice, else the instance default (a theme that is gone counts as none). */
  async startingTheme(accountId: string): Promise<StartingTheme> {
    const installed = await this.deps.themes.list();
    const known = (id: string | null) => (id !== null && this.exists(id, installed) ? id : null);
    const own = known(await this.deps.themes.getChoice(accountThemeScope(accountId)));
    const themeId = own ?? known(await this.deps.themes.getChoice(INSTANCE_THEME_SCOPE)) ?? DEFAULT_THEME_ID;
    const pkg = installed.find((t) => t.id === themeId);
    return { themeId, own: own !== null, packageScheme: pkg?.colorScheme ?? null };
  }

  async install(actor: Actor | null, source: PackageSource): Promise<InstalledTheme> {
    requireInstanceRole(actor, 'admin');
    const staged = await this.deps.installer.stage(source);
    try {
      if (staged.kind !== 'theme')
        throw new ValidationError('This package is a plugin; install it as a plugin');
      if (this.deps.builtInIds.includes(staged.theme.id)) {
        throw new ValidationError(`"${staged.theme.id}" is a built-in theme id`);
      }
      if (!this.deps.builtInIds.includes(staged.theme.extends)) {
        throw new ValidationError(`Unknown base theme "${staged.theme.extends}"`);
      }
      const theme: InstalledTheme = { ...staged.theme, installedAt: this.deps.clock.now() };
      await this.deps.themes.save(theme);
      return theme;
    } finally {
      // Theme tokens live in the database; the package files are not needed afterwards.
      await this.deps.installer.discard(staged).catch(() => undefined);
    }
  }

  async uninstall(actor: Actor | null, id: string): Promise<void> {
    requireInstanceRole(actor, 'admin');
    await this.deps.uow.transaction(async () => {
      if (!(await this.deps.themes.findById(id))) throw new NotFoundError('Theme');
      await this.deps.themes.delete(id);
      await this.deps.themes.clearChoicesOf(id);
    });
  }

  async setDefault(actor: Actor | null, themeId: string): Promise<ThemeOverview> {
    requireInstanceRole(actor, 'admin');
    await this.requireTheme(themeId);
    await this.deps.themes.setChoice(INSTANCE_THEME_SCOPE, themeId);
    return this.overview(actor);
  }

  /** The account's own theme; null goes back to the instance default. */
  async select(actor: Actor | null, themeId: string | null): Promise<ThemeOverview> {
    const account = requireAccount(actor);
    if (themeId !== null) await this.requireTheme(themeId);
    await this.deps.themes.setChoice(accountThemeScope(account.id), themeId);
    return this.overview(actor);
  }

  private async requireTheme(id: string): Promise<void> {
    if (this.deps.builtInIds.includes(id)) return;
    if (!(await this.deps.themes.findById(id))) throw new NotFoundError('Theme');
  }

  private exists(id: string, installed: readonly InstalledTheme[]): boolean {
    return this.deps.builtInIds.includes(id) || installed.some((t) => t.id === id);
  }
}
