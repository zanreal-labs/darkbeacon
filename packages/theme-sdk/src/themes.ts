import type { TokenName, TokenValues } from './tokens.js';

export interface Theme {
  id: string;
  name: string;
  colorScheme: 'light' | 'dark';
  tokens: TokenValues;
}

/** A theme preference that follows the operating system: light or dark (or contrast, see below). */
export const SYSTEM_THEME_ID = 'system';
/** Built-in themes the `system` preference switches between. */
export const SYSTEM_THEMES = { light: 'default', dark: 'dark', contrast: 'contrast' } as const;

/**
 * The cookie the web app's head script reads before the first paint (not httpOnly, not a secret):
 * a theme id, or for a theme package `<id>|<built-in id>`, the built-in theme of the package's
 * colour scheme to show while the package's own CSS is not in the browser yet.
 */
export const THEME_COOKIE = 'dbk_theme';

export function themeCookieValue(themeId: string, packageScheme?: 'light' | 'dark' | null): string {
  return packageScheme ? `${themeId}|${SYSTEM_THEMES[packageScheme]}` : themeId;
}

export function parseThemeCookie(value: string): { themeId: string; fallback: string | null } {
  const at = value.indexOf('|');
  return at < 0
    ? { themeId: value, fallback: null }
    : { themeId: value.slice(0, at), fallback: value.slice(at + 1) };
}

/**
 * The theme id to apply for a preference. `system` follows `prefers-color-scheme` and, when the
 * system asks for more contrast, picks the contrast theme.
 */
export function resolveThemePreference(
  preference: string,
  system: { dark: boolean; moreContrast?: boolean },
): string {
  if (preference !== SYSTEM_THEME_ID) return preference;
  if (system.moreContrast) return SYSTEM_THEMES.contrast;
  return system.dark ? SYSTEM_THEMES.dark : SYSTEM_THEMES.light;
}

/** Derived colours reference other tokens, so theme packages that change a base colour get them too. */
const mix = (token: TokenName, percent: number, over = 'transparent') =>
  `color-mix(in oklab, var(--dbk-${token}) ${percent}%, ${over})`;

/** Values shared by light and dark. */
const shared = {
  'font-family': "'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  'font-family-mono':
    "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  'font-size-xs': '11px',
  'font-size-small': '12px',
  'font-size': '13px',
  'font-size-large': '15px',
  'font-size-title': '20px',
  'line-height': '1.5',
  'space-1': '4px',
  'space-2': '8px',
  'space-3': '12px',
  'space-4': '16px',
  'space-5': '24px',
  'space-6': '32px',
  'radius-small': '4px',
  radius: '6px',
  'radius-large': '10px',
  'control-height-small': '26px',
  'control-height': '32px',
  'node-radius': '8px',
  'node-border-width': '1px',
  'node-min-width': '168px',
  'node-padding': '8px 10px',
  'edge-width': '2.5px',
  'motion-fast': '120ms',
  'motion-normal': '180ms',
  'motion-easing': 'cubic-bezier(0.2, 0, 0, 1)',
  'brand-discord': '#5865f2',
  'brand-discord-hover': '#4752c4',
  'brand-discord-contrast': '#ffffff',
  'color-accent-subtle': mix('color-accent', 14),
  'color-danger-subtle': mix('color-danger', 12),
  'color-warning-subtle': mix('color-warning', 14),
  'color-success-subtle': mix('color-success', 12),
} as const satisfies Partial<TokenValues>;

type PairedToken = Exclude<TokenName, keyof typeof shared>;

/**
 * Every colour as a `[light, dark]` pair: the light and dark built-in themes are two readings of
 * the same palette, so they stay in step.
 */
const paired: Record<PairedToken, readonly [light: string, dark: string]> = {
  // Surfaces: neutral light; deep graphite (never pure black) in the dark.
  'color-bg': ['#f7f8fa', '#0d0f14'],
  'color-bg-subtle': ['#f0f2f5', '#0a0c10'],
  'color-surface': ['#ffffff', '#13161d'],
  'color-surface-raised': ['#ffffff', '#191d26'],
  'color-surface-hover': ['#f1f3f6', '#1c212b'],
  'color-surface-active': ['#e8ebf0', '#232935'],
  'color-border': ['#e2e5ea', '#232833'],
  'color-border-strong': ['#c9ced7', '#343b49'],
  'color-text': ['#14171f', '#e6e9ef'],
  'color-text-muted': ['#596170', '#9aa3b2'],
  'color-text-subtle': ['#646b79', '#7d8697'],
  // One accent, cyan-teal.
  'color-accent': ['#0b7f91', '#38c6d6'],
  'color-accent-hover': ['#096c7c', '#5dd3e0'],
  'color-accent-contrast': ['#ffffff', '#041619'],
  'color-accent-text': ['#0a7384', '#5dd3e0'],
  'color-danger': ['#c42f3e', '#f0616d'],
  'color-warning': ['#9a5806', '#eba23b'],
  'color-success': ['#177346', '#3fbf7f'],
  'color-focus': ['#0b7f91', '#5dd3e0'],
  'color-overlay': ['rgba(15, 18, 25, 0.36)', 'rgba(3, 5, 8, 0.66)'],
  'color-canvas': ['#f3f5f8', '#0a0c10'],
  'color-canvas-grid': ['#d3d8e0', '#1f2430'],
  // Security status, close to the in-game palette but readable on both backgrounds.
  'security-high': ['#137a40', '#3fd47a'],
  'security-low': ['#b0560b', '#ef8a3c'],
  'security-null': ['#d12f2f', '#f05252'],
  'security-wormhole': ['#4760dd', '#7b93ff'],
  'security-special': ['#8a4bd6', '#b98cf5'],
  'status-home': ['#0b7f91', '#38c6d6'],
  'status-friendly': ['#177346', '#3fbf7f'],
  'status-empty': ['#7d8593', '#7d8798'],
  'status-occupied': ['#b0560b', '#ef8a3c'],
  'status-warning': ['#b48a00', '#f0c541'],
  'status-hostile': ['#d12f2f', '#f05252'],
  'node-bg': ['#ffffff', '#151920'],
  'node-border': ['#cdd2da', '#2e3542'],
  'node-text': ['#14171f', '#e6e9ef'],
  'node-selected-border': ['#0b7f91', '#38c6d6'],
  'edge-color': ['#7f8899', '#7d8799'],
  'edge-gate': ['#177346', '#3fbf7f'],
  'edge-bridge': ['#8a4bd6', '#b98cf5'],
  'edge-time-eol': ['#a43cd2', '#cf7cf2'],
  'edge-mass-reduced': ['#a87207', '#eba23b'],
  'edge-mass-critical': ['#d12f2f', '#f05252'],
  'edge-dangerous': ['rgba(209, 47, 47, 0.28)', 'rgba(240, 82, 82, 0.32)'],
  'edge-bubble': ['#d12f2f', '#f05252'],
  'edge-selected': ['#0b7f91', '#5dd3e0'],
  'shadow-small': ['0 1px 2px rgba(16, 24, 40, 0.06)', '0 1px 2px rgba(0, 0, 0, 0.4)'],
  'shadow-medium': [
    '0 4px 12px rgba(16, 24, 40, 0.08), 0 1px 3px rgba(16, 24, 40, 0.06)',
    '0 6px 20px rgba(0, 0, 0, 0.45), 0 1px 3px rgba(0, 0, 0, 0.4)',
  ],
  'shadow-large': [
    '0 18px 48px rgba(16, 24, 40, 0.16), 0 2px 6px rgba(16, 24, 40, 0.06)',
    '0 24px 64px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.45)',
  ],
};

function fromPalette(index: 0 | 1): TokenValues {
  const colors = Object.fromEntries(Object.entries(paired).map(([name, pair]) => [name, pair[index]]));
  return { ...shared, ...colors } as TokenValues;
}

/** Light. Keeps the id `default` so stored choices and theme packages extending it still work. */
export const lightTheme: Theme = {
  id: 'default',
  name: 'Light',
  colorScheme: 'light',
  tokens: fromPalette(0),
};

/** @deprecated use `lightTheme`; the id stays `default`. */
export const defaultTheme = lightTheme;

export const darkTheme: Theme = {
  id: 'dark',
  name: 'Dark',
  colorScheme: 'dark',
  tokens: fromPalette(1),
};

/** High contrast: black, white borders, bright saturated signals, thicker strokes. */
export const contrastTheme: Theme = {
  id: 'contrast',
  name: 'High contrast',
  colorScheme: 'dark',
  tokens: {
    ...darkTheme.tokens,
    'color-bg': '#000000',
    'color-bg-subtle': '#000000',
    'color-surface': '#000000',
    'color-surface-raised': '#0c0c0c',
    'color-surface-hover': '#1a1a1a',
    'color-surface-active': '#262626',
    'color-border': '#ffffff',
    'color-border-strong': '#ffffff',
    'color-text': '#ffffff',
    'color-text-muted': '#e0e0e0',
    'color-text-subtle': '#bdbdbd',
    'color-accent': '#ffd400',
    'color-accent-hover': '#ffe14d',
    'color-accent-contrast': '#000000',
    'color-accent-text': '#ffd400',
    'color-accent-subtle': 'rgba(255, 212, 0, 0.22)',
    'color-danger': '#ff4d4d',
    'color-warning': '#ffb000',
    'color-success': '#00e676',
    'color-focus': '#00e5ff',
    'color-overlay': 'rgba(0, 0, 0, 0.8)',
    'color-canvas': '#000000',
    'color-canvas-grid': '#3a3a3a',
    'security-high': '#00ff6a',
    'security-low': '#ffa000',
    'security-null': '#ff3030',
    'security-wormhole': '#7fa0ff',
    'security-special': '#ff66ff',
    'node-bg': '#000000',
    'node-border': '#ffffff',
    'node-text': '#ffffff',
    'node-selected-border': '#ffd400',
    'node-border-width': '2px',
    'edge-width': '3px',
    'edge-color': '#ffffff',
    'edge-gate': '#00ff6a',
    'edge-bridge': '#ff66ff',
    'edge-time-eol': '#ff66ff',
    'edge-mass-reduced': '#ffb000',
    'edge-mass-critical': '#ff3030',
    'edge-dangerous': 'rgba(255, 48, 48, 0.5)',
    'edge-bubble': '#ff3030',
    'edge-selected': '#00e5ff',
    'shadow-small': 'none',
    'shadow-medium': '0 0 0 1px #ffffff',
    'shadow-large': '0 0 0 2px #ffffff',
  },
};

export const builtInThemes: readonly Theme[] = [lightTheme, darkTheme, contrastTheme];
