'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { routes, type ThemesDto } from '@darkbeacon/shared';
import {
  builtInThemes,
  resolveThemePreference,
  SYSTEM_THEME_ID,
  themeToCss,
  type Theme,
  type TokenValues,
} from '@darkbeacon/theme-sdk';
import {
  LEGACY_THEME_STORAGE_KEY as LEGACY_STORAGE_KEY,
  PACKAGE_CSS_STORAGE_KEY,
  THEME_COOKIE,
  THEME_STORAGE_KEY as STORAGE_KEY,
} from './head';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const CONTRAST_QUERY = '(prefers-contrast: more)';

export interface ThemeOption {
  id: string;
  name: string;
  colorScheme: 'light' | 'dark' | 'system';
  builtIn: boolean;
}

interface ThemeContextValue {
  /** The theme in effect (for `system`, the light or dark one the OS asks for). */
  theme: Theme;
  /** What the person picked: `system` (default), a built-in or an installed theme id. */
  preference: string;
  /** Every concrete theme: built-in ones and theme packages installed on the server. */
  themes: readonly Theme[];
  /** `system` followed by every theme, for pickers. */
  options: readonly ThemeOption[];
  /** Instance default chosen by an admin (`system` unless changed). */
  defaultThemeId: string;
  setPreference(id: string): void;
  /** @deprecated alias of `setPreference`. */
  setTheme(id: string): void;
  /** Re-reads installed themes and the account's choice (after sign-in or an admin change). */
  refresh(): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function cookiePreference(): string | null {
  if (typeof document === 'undefined') return null;
  const match = new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`).exec(document.cookie);
  try {
    return match ? decodeURIComponent(match[1]!) : null;
  } catch {
    return null;
  }
}

/** The saved choice: the cookie the head script reads first, else the browser's copy. */
function storedPreference(): string | null {
  const cookie = cookiePreference();
  if (cookie !== null) return cookie;
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current !== null) return current;
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy !== null) {
      localStorage.setItem(STORAGE_KEY, legacy);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    return legacy;
  } catch {
    // Storage can be unavailable (private mode).
    return null;
  }
}

/** Saved as a cookie (read before the first paint) and mirrored to localStorage. */
function storePreference(id: string): void {
  if (typeof document !== 'undefined') {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${THEME_COOKIE}=${encodeURIComponent(id)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  }
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Not kept locally; the cookie and the server copy still apply.
  }
}

/** Another tab saved a different choice. */
function subscribeStorage(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

const subscribeNothing = () => () => {};

/** Keeps the CSS of a picked theme package for the head script of the next visit. */
function storePackageCss(theme: Theme | undefined): void {
  try {
    if (theme) localStorage.setItem(PACKAGE_CSS_STORAGE_KEY, themeToCss(theme, `[data-theme="${theme.id}"]`));
    else localStorage.removeItem(PACKAGE_CSS_STORAGE_KEY);
  } catch {
    // Without storage a theme package applies once the theme list loaded.
  }
}

function matches(query: string): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(query).matches;
}

function systemState() {
  return { dark: matches(DARK_QUERY), moreContrast: matches(CONTRAST_QUERY) };
}

function subscribeSystem(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const lists = [window.matchMedia(DARK_QUERY), window.matchMedia(CONTRAST_QUERY)];
  for (const list of lists) list.addEventListener?.('change', onChange);
  return () => {
    for (const list of lists) list.removeEventListener?.('change', onChange);
  };
}

/** `dark|contrast` packed into one string so useSyncExternalStore compares by value. */
function systemSnapshot(): string {
  const { dark, moreContrast } = systemState();
  return `${dark ? 'dark' : 'light'}|${moreContrast ? 'more' : 'normal'}`;
}

/** Follows the operating system's light/dark (and contrast) setting live. */
export function useSystemColorScheme(): { dark: boolean; moreContrast: boolean } {
  const snapshot = useSyncExternalStore(subscribeSystem, systemSnapshot, () => 'light|normal');
  return useMemo(() => {
    const [scheme, contrast] = snapshot.split('|');
    return { dark: scheme === 'dark', moreContrast: contrast === 'more' };
  }, [snapshot]);
}

function apply(themeId: string, colorScheme: 'light' | 'dark'): void {
  const root = document.documentElement;
  root.dataset.theme = themeId;
  root.style.colorScheme = colorScheme;
}

/** CSS for themes installed on the server (theme packages), next to the built-in ones. */
function installPackageThemes(themes: readonly Theme[]): void {
  let style = document.getElementById('dbk-package-themes');
  if (!style) {
    style = document.createElement('style');
    style.id = 'dbk-package-themes';
    document.head.append(style);
  }
  style.textContent = themes.map((t) => themeToCss(t, `[data-theme="${t.id}"]`)).join('');
}

/**
 * Applies the theme with `data-theme` on <html>. The preference defaults to `system`, which follows
 * the OS light/dark mode live. An account's choice is stored on the server; the browser keeps a copy
 * so the page does not flash before the server answers.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  // The saved choice is read in the browser only; the server renders `system`. Nothing is
  // applied until it is known (the head script already applied it), so there is no flash.
  const stored = useSyncExternalStore(subscribeStorage, storedPreference, () => null);
  const inBrowser = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  // A choice made here (or the account's, from the server) wins over the stored one.
  const [chosen, setPreferenceState] = useState<string | null>(null);
  const preference = chosen ?? stored ?? SYSTEM_THEME_ID;
  const [themes, setThemes] = useState<readonly Theme[]>(builtInThemes);
  const [defaultThemeId, setDefaultThemeId] = useState(SYSTEM_THEME_ID);
  const [version, setVersion] = useState(0);
  const system = useSystemColorScheme();
  const themesRef = useRef(themes);
  useEffect(() => {
    themesRef.current = themes;
  }, [themes]);

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
        const known = (id: string | null) =>
          id !== null && (id === SYSTEM_THEME_ID || all.some((t) => t.id === id)) ? id : null;
        const chosen = known(data.selectedThemeId) ?? known(storedPreference()) ?? data.defaultThemeId;
        setPreferenceState(chosen);
        storePreference(chosen);
        storePackageCss(all.find((t) => t.id === chosen && !t.builtIn));
      })
      .catch(() => {
        // Offline or no server (tests, mock mode): the built-in themes still work.
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const resolvedId = resolveThemePreference(preference, system);
  const theme = themes.find((t) => t.id === resolvedId) ?? builtInThemes[0]!;

  useLayoutEffect(() => {
    if (inBrowser) apply(theme.id, theme.colorScheme);
  }, [theme, inBrowser]);

  const setPreference = useCallback((id: string) => {
    setPreferenceState(id);
    storePreference(id);
    storePackageCss(themesRef.current.find((t) => t.id === id && !builtInThemes.some((b) => b.id === t.id)));
    // Signed out this answers 401, and the browser copy is all there is.
    void fetch(routes.themes.select.path, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ themeId: id }),
    }).catch(() => {});
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      preference,
      themes,
      options: [
        { id: SYSTEM_THEME_ID, name: 'System', colorScheme: 'system', builtIn: true },
        ...themes.map((t) => ({
          id: t.id,
          name: t.name,
          colorScheme: t.colorScheme,
          builtIn: builtInThemes.some((b) => b.id === t.id),
        })),
      ],
      defaultThemeId,
      setPreference,
      setTheme: setPreference,
      refresh: () => setVersion((v) => v + 1),
    }),
    [theme, preference, themes, defaultThemeId, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme outside ThemeProvider');
  return value;
}
