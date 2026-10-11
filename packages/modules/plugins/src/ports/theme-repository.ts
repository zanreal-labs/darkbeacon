import type { InstalledTheme } from '../domain/theme.js';

export interface ThemeRepository {
  list(): Promise<InstalledTheme[]>;
  findById(id: string): Promise<InstalledTheme | null>;
  /** Inserts or replaces. */
  save(theme: InstalledTheme): Promise<void>;
  delete(id: string): Promise<void>;
  /** Theme chosen for a scope (`instance` or `account:<id>`), null when none. */
  getChoice(scope: string): Promise<string | null>;
  setChoice(scope: string, themeId: string | null): Promise<void>;
  /** Forgets every choice of a removed theme. */
  clearChoicesOf(themeId: string): Promise<void>;
}
