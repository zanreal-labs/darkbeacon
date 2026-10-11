import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { builtInThemes, themesToCss, type Theme } from '@wormwright/theme-sdk';

const STORAGE_KEY = 'ww-theme';

interface ThemeContextValue {
  theme: Theme;
  themes: readonly Theme[];
  setTheme(id: string): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function initialThemeId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && builtInThemes.some((t) => t.id === stored)) return stored;
  } catch {
    // Storage can be unavailable (private mode); fall through to the system preference.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'default';
}

/** Writes every theme's tokens as CSS variables. Call before the first render to avoid a flash. */
export function installThemes(): void {
  if (document.getElementById('ww-themes')) return;
  const style = document.createElement('style');
  style.id = 'ww-themes';
  style.textContent = themesToCss(builtInThemes);
  document.head.prepend(style);
  document.documentElement.dataset.theme = initialThemeId();
}

/** Switches themes with `data-theme` on <html>. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState(initialThemeId);

  useEffect(() => {
    document.documentElement.dataset.theme = themeId;
  }, [themeId]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: builtInThemes.find((t) => t.id === themeId) ?? builtInThemes[0]!,
      themes: builtInThemes,
      setTheme(id) {
        setThemeId(id);
        try {
          localStorage.setItem(STORAGE_KEY, id);
        } catch {
          // Not persisted; the choice still applies for this visit.
        }
      },
    }),
    [themeId],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme outside ThemeProvider');
  return value;
}
