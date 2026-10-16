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
  'map-text-scale': '1',
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
  'node-min-width': '200px',
  'node-padding': '8px 10px',
  'edge-width': '12px',
  // Standings exactly as the game client colours them, the same in every theme (like the
  // security colours): +10 dark blue, +5 light blue, neutral grey, -5 orange, -10 red. Sampled
  // from the client's standing tag backgrounds as the EVE University wiki keeps them
  // (https://wiki.eveuniversity.org/Color_Tag_Images: ColorTagBG-BlueDark, -BlueLight, -Grey,
  // -Orange and -Red). White text reads on all but neutral (4.97:1 and up, contrast test).
  'standing-excellent': '#042274',
  'standing-good': '#2c66c4',
  'standing-neutral': '#8c8a8c',
  'standing-bad': '#c44604',
  'standing-terrible': '#940604',
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
  // Text colours of high, low and null-sec (static codes, route squares). Dark mode takes the
  // game client's own colours (0.8, 0.4 and 0.0); light mode darker shades of them, to stay legible.
  'security-high': ['#00872a', '#00ef47'],
  'security-low': ['#a85a00', '#d77700'],
  'security-null': ['#c40000', '#f00000'],
  'security-wormhole': ['#4760dd', '#7b93ff'],
  'security-special': ['#8a4bd6', '#b98cf5'],
  // Muted on purpose: a status tints a whole node background (`node-tint` of it), and a chain of
  // bright boxes shouts.
  'status-home': ['#3d63b8', '#6286cc'],
  'status-friendly': ['#3f7a5c', '#5e9e7d'],
  'status-empty': ['#7d8593', '#7d8798'],
  'status-occupied': ['#9a6236', '#b58157'],
  'status-warning': ['#977a1c', '#c4a64a'],
  'status-hostile': ['#b73c3c', '#d26060'],
  'status-target': ['#6f55b8', '#9583cc'],
  // Wormhole effects: a small dot on the node, one hue each, as mappers have always drawn them.
  'effect-black-hole': ['#4b5563', '#a1a9b8'],
  'effect-cataclysmic-variable': ['#0e7490', '#22d3ee'],
  'effect-magnetar': ['#be185d', '#f472b6'],
  'effect-pulsar': ['#1d4ed8', '#60a5fa'],
  'effect-red-giant': ['#b91c1c', '#f87171'],
  'effect-wolf-rayet': ['#b45309', '#fbbf24'],
  'node-bg': ['#ffffff', '#151920'],
  'node-border': ['#b9c0cb', '#3a4252'],
  'node-text': ['#14171f', '#e6e9ef'],
  'node-selected-border': ['#0b7f91', '#38c6d6'],
  // How much of the status colour tints a node (its strongest edge; the rest fades to half).
  'node-tint': ['16%', '22%'],
  // The same for the holder's standing on an unmarked system: stronger, because the game's
  // standing colours are dark (+10 navy, -10 maroon) and must stay apart from +5 and -5 as tints;
  // light stops where secondary text would drop under 4.5:1 (contrast test).
  'node-tint-standing': ['23%', '40%'],
  // Designation pills: a solid EVE-ish fill with dark bold text, the same in light and dark.
  'node-pill-text': ['#0a0c10', '#0a0c10'],
  'pill-wormhole': ['#7b93ff', '#7b93ff'],
  'pill-special': ['#c39cf7', '#c39cf7'],
  // Connections: one thick two-layer line; the outer layer is time, the inner core is mass.
  // Normal connections are one solid, high-contrast line: a fresh core matches the outer layer, so
  // only a state that matters (EOL, reduced or critical mass) shows a second colour.
  'edge-color': ['#6b7486', '#9aa3b4'],
  'edge-gate': ['#6b7486', '#9aa3b4'],
  'edge-bridge': ['#5b8a00', '#a3e635'],
  'edge-mass-fresh': ['#6b7486', '#9aa3b4'],
  'edge-time-eol': ['#8f3fc2', '#b25ee0'],
  'edge-time-critical': ['#e0338a', '#ff5fae'],
  'edge-mass-reduced': ['#f2b01e', '#f5b83a'],
  'edge-mass-critical': ['#e02424', '#ff4040'],
  'edge-dangerous': ['#d12f2f', '#f05252'],
  'edge-bubble': ['#c27400', '#ffb03a'],
  'edge-selected': ['#0b7f91', '#5dd3e0'],
  // People on the map: eight hues that stay apart from each other and readable on the canvas.
  'presence-0': ['#2563eb', '#60a5fa'],
  'presence-1': ['#c026d3', '#e879f9'],
  'presence-2': ['#c2410c', '#fb923c'],
  'presence-3': ['#0f766e', '#2dd4bf'],
  'presence-4': ['#6d28d9', '#a78bfa'],
  'presence-5': ['#be123c', '#fb7185'],
  'presence-6': ['#4d7c0f', '#a3e635'],
  'presence-7': ['#a16207', '#facc15'],
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
    'node-border-width': '1px',
    'node-tint': '30%',
    'node-tint-standing': '40%',
    'edge-width': '13px',
    'edge-color': '#ffffff',
    'edge-gate': '#d0d0d0',
    'edge-bridge': '#c6ff00',
    'edge-mass-fresh': '#000000',
    'edge-time-eol': '#c04dff',
    'edge-time-critical': '#ff3fa4',
    'node-pill-text': '#000000',
    'edge-mass-reduced': '#ffb000',
    'edge-mass-critical': '#ff3030',
    'edge-dangerous': 'rgba(255, 48, 48, 0.5)',
    'edge-bubble': '#ff66cc',
    'status-target': '#b388ff',
    'edge-selected': '#00e5ff',
    'shadow-small': 'none',
    'shadow-medium': '0 0 0 1px #ffffff',
    'shadow-large': '0 0 0 2px #ffffff',
  },
};

export const builtInThemes: readonly Theme[] = [lightTheme, darkTheme, contrastTheme];
