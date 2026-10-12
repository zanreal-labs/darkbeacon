/** A theme package: tokens on top of a built-in theme. Stored in the database, no files kept. */
export interface InstalledTheme {
  id: string;
  name: string;
  version: string;
  colorScheme: 'light' | 'dark';
  /** Built-in theme the tokens override. */
  extends: string;
  tokens: Record<string, string>;
  installedAt: number;
}

/** New instances follow the operating system's light or dark mode (`system` in theme-sdk). */
export const DEFAULT_THEME_ID = 'system';

/** Theme choices are stored per scope: the instance default and one per account. */
export const INSTANCE_THEME_SCOPE = 'instance';

export function accountThemeScope(accountId: string): string {
  return `account:${accountId}`;
}
