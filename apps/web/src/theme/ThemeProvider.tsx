import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { routes, type ThemesDto } from '@wormwright/shared';
import { builtInThemes, themeToCss, themesToCss, type Theme, type TokenValues } from '@wormwright/theme-sdk';

const STORAGE_KEY = 'ww-theme';

interface ThemeContextValue {
  theme: Theme;
  themes: readonly Theme[];
  /** Instance default chosen by an admin. */
  defaultThemeId: string;
  setTheme(id: string): void;
  /** Re-reads installed themes and the account's choice (after sign-in or an admin change). */
  refresh(): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function storedThemeId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode).
    return null;
  }
}

function initialThemeId(): string {
  const stored = storedThemeId();
  if (stored) return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'default';
}

/** Writes every built-in theme's tokens as CSS variables. Call before the first render to avoid a flash. */
export function installThemes(): void {
  if (document.getElementById('ww-themes')) return;
  const style = document.createElement('style');
  style.id = 'ww-themes';
  style.textContent = themesToCss(builtInThemes);
  document.head.prepend(style);
  document.documentElement.dataset.theme = initialThemeId();
}

/** CSS for themes installed on the server (theme packages), next to the built-in ones. */
function installPackageThemes(themes: readonly Theme[]): void {
  let style = document.getElementById('ww-package-themes');
  if (!style) {
    style = document.createElement('style');
    style.id = 'ww-package-themes';
    document.head.append(style);
  }
  style.textContent = themes.map((t) => themeToCss(t, `[data-theme="${t.id}"]`)).join('');
}

/**
 * Switches themes with `data-theme` on <html>. The account's choice is stored on the server;
 * the browser keeps a copy so the page does not flash before the server answers.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState(initialThemeId);
  const [themes, setThemes] = useState<readonly Theme[]>(builtInThemes);
  const [defaultThemeId, setDefaultThemeId] = useState('default');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(routes.themes.list.path, { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<ThemesDto>) : null))
      .then((data) => {
        if (cancelled || !data) return;
        const all = data.themes.map((t) => ({ ...t, tokens: t.tokens as TokenValues }));
        installPackageThemes(all.filter((t) => !t.builtIn));
        setThemes(all);
        setDefaultThemeId(data.defaultThemeId);
        const chosen = data.selectedThemeId ?? storedThemeId() ?? data.defaultThemeId;
        setThemeId(all.some((t) => t.id === chosen) ? chosen : data.defaultThemeId);
      })
      .catch(() => {
        // Offline or no server (tests, mock mode): the built-in themes still work.
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeId;
  }, [themeId]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: themes.find((t) => t.id === themeId) ?? builtInThemes[0]!,
      themes,
      defaultThemeId,
      setTheme(id) {
        setThemeId(id);
        try {
          localStorage.setItem(STORAGE_KEY, id);
        } catch {
          // Not persisted locally; the server copy below still applies.
        }
        // Signed out this answers 401, and the browser copy is all there is.
        void fetch(routes.themes.select.path, {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ themeId: id }),
        }).catch(() => {});
      },
      refresh: () => setVersion((v) => v + 1),
    }),
    [themeId, themes, defaultThemeId],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme outside ThemeProvider');
  return value;
}
