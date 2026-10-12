export type TokenGroup =
  | 'color'
  | 'brand'
  | 'security'
  | 'status'
  | 'node'
  | 'edge'
  | 'typography'
  | 'density'
  | 'elevation'
  | 'motion'
  | 'presence';

export interface TokenInfo {
  group: TokenGroup;
  description: string;
}

/**
 * Every themeable value. Components read them as CSS custom properties (`--dbk-<name>`);
 * a theme must define all of them, so no feature disappears in another theme.
 */
export const TOKENS = {
  'color-bg': { group: 'color', description: 'App background' },
  'color-bg-subtle': { group: 'color', description: 'Navigation rail, sunken areas' },
  'color-surface': { group: 'color', description: 'Panels and cards' },
  'color-surface-raised': { group: 'color', description: 'Menus, popovers, dialogs' },
  'color-surface-hover': { group: 'color', description: 'Hovered rows and quiet buttons' },
  'color-surface-active': { group: 'color', description: 'Pressed or selected rows' },
  'color-border': { group: 'color', description: 'Dividers and control borders' },
  'color-border-strong': { group: 'color', description: 'Hovered control borders, emphasis' },
  'color-text': { group: 'color', description: 'Primary text' },
  'color-text-muted': { group: 'color', description: 'Secondary text' },
  'color-text-subtle': { group: 'color', description: 'Placeholders, hints, disabled text' },
  'color-accent': { group: 'color', description: 'Primary actions, selection' },
  'color-accent-hover': { group: 'color', description: 'Hovered primary actions' },
  'color-accent-contrast': { group: 'color', description: 'Text on accent' },
  'color-accent-subtle': { group: 'color', description: 'Tinted background of selected items' },
  'color-accent-text': { group: 'color', description: 'Accent coloured text and links' },
  'color-danger': { group: 'color', description: 'Destructive actions, errors' },
  'color-danger-subtle': { group: 'color', description: 'Background of error notices' },
  'color-warning': { group: 'color', description: 'Warnings' },
  'color-warning-subtle': { group: 'color', description: 'Background of warning notices' },
  'color-success': { group: 'color', description: 'Success states' },
  'color-success-subtle': { group: 'color', description: 'Background of success notices' },
  'color-focus': { group: 'color', description: 'Keyboard focus ring' },
  'color-overlay': { group: 'color', description: 'Backdrop behind dialogs and sheets' },
  'color-canvas': { group: 'color', description: 'Map canvas background' },
  'color-canvas-grid': { group: 'color', description: 'Map canvas dots/grid' },

  'brand-discord': { group: 'brand', description: 'Discord sign-in button' },
  'brand-discord-hover': { group: 'brand', description: 'Hovered Discord sign-in button' },
  'brand-discord-contrast': { group: 'brand', description: 'Text on the Discord button' },

  'security-high': { group: 'security', description: 'High-sec (0.5 and up)' },
  'security-low': { group: 'security', description: 'Low-sec (0.1-0.4)' },
  'security-null': { group: 'security', description: 'Null-sec' },
  'security-wormhole': { group: 'security', description: 'Wormhole space (C1-C6)' },
  'security-special': { group: 'security', description: 'Thera, Pochven, Drifter, shattered' },

  'status-home': { group: 'status', description: 'System status: home' },
  'status-friendly': { group: 'status', description: 'System status: friendly' },
  'status-empty': { group: 'status', description: 'System status: empty' },
  'status-occupied': { group: 'status', description: 'System status: occupied' },
  'status-warning': { group: 'status', description: 'System status: warning' },
  'status-hostile': { group: 'status', description: 'System status: hostile' },
  'status-target': { group: 'status', description: 'System status: target' },

  'effect-black-hole': { group: 'status', description: 'Wormhole effect dot: Black Hole' },
  'effect-cataclysmic-variable': {
    group: 'status',
    description: 'Wormhole effect dot: Cataclysmic Variable',
  },
  'effect-magnetar': { group: 'status', description: 'Wormhole effect dot: Magnetar' },
  'effect-pulsar': { group: 'status', description: 'Wormhole effect dot: Pulsar' },
  'effect-red-giant': { group: 'status', description: 'Wormhole effect dot: Red Giant' },
  'effect-wolf-rayet': { group: 'status', description: 'Wormhole effect dot: Wolf-Rayet' },
  'standing-excellent': { group: 'status', description: 'Standing +10 (and your own alliance)' },
  'standing-good': { group: 'status', description: 'Standing +5' },
  'standing-neutral': { group: 'status', description: 'Neutral or no standing' },
  'standing-bad': { group: 'status', description: 'Standing -5' },
  'standing-terrible': { group: 'status', description: 'Standing -10' },

  'node-bg': { group: 'node', description: 'System node background' },
  'node-border': { group: 'node', description: 'System node border' },
  'node-text': { group: 'node', description: 'System node text' },
  'node-selected-border': { group: 'node', description: 'Selected node border' },
  'node-pill-text': { group: 'node', description: 'Text on a filled designation pill (class or security)' },
  'pill-wormhole': { group: 'node', description: 'Designation pill fill of wormhole classes C1-C6' },
  'pill-special': { group: 'node', description: 'Designation pill fill of Thera, C13, Drifter and Pochven' },
  'node-radius': { group: 'node', description: 'Node corner radius' },
  'node-border-width': { group: 'node', description: 'Node border width (the border carries the status)' },
  'node-min-width': { group: 'node', description: 'Node minimum width' },
  'node-padding': { group: 'node', description: 'Node inner padding' },

  'edge-width': {
    group: 'edge',
    description: 'Connection width (outer layer), the same for every connection',
  },
  'edge-color': { group: 'edge', description: 'Outer layer: lifetime normal' },
  'edge-mass-fresh': { group: 'edge', description: 'Inner core: mass fresh' },
  'edge-gate': { group: 'edge', description: 'Stargate connection' },
  'edge-bridge': { group: 'edge', description: 'Ansiblex jump bridge connection (dotted)' },
  'edge-time-eol': { group: 'edge', description: 'Outer layer: end of life (< 4 h)' },
  'edge-time-critical': { group: 'edge', description: 'Outer layer: under an hour left' },
  'edge-mass-reduced': { group: 'edge', description: 'Inner core: mass reduced (10-50 %)' },
  'edge-mass-critical': { group: 'edge', description: 'Inner core: mass critical (< 10 %)' },
  'edge-dangerous': { group: 'edge', description: 'Red halo beyond a dangerous connection' },
  'edge-bubble': { group: 'edge', description: 'Bubble circle on the line next to a bubbled system' },
  'edge-selected': { group: 'edge', description: 'Selected connection' },

  'font-family': { group: 'typography', description: 'UI font stack' },
  'font-family-mono': { group: 'typography', description: 'Monospace font stack' },
  'font-size': { group: 'typography', description: 'Base font size' },
  'font-size-xs': { group: 'typography', description: 'Captions, badges' },
  'font-size-small': { group: 'typography', description: 'Small text, node details' },
  'font-size-large': { group: 'typography', description: 'Section titles' },
  'font-size-title': { group: 'typography', description: 'Page titles' },
  'line-height': { group: 'typography', description: 'Base line height' },

  'space-1': { group: 'density', description: 'Smallest spacing step' },
  'space-2': { group: 'density', description: 'Small spacing step' },
  'space-3': { group: 'density', description: 'Medium spacing step' },
  'space-4': { group: 'density', description: 'Large spacing step' },
  'space-5': { group: 'density', description: 'Section spacing' },
  'space-6': { group: 'density', description: 'Page spacing' },
  'radius-small': { group: 'density', description: 'Badges, checkboxes, small controls' },
  radius: { group: 'density', description: 'Default corner radius' },
  'radius-large': { group: 'density', description: 'Cards, dialogs, sheets' },
  'control-height-small': { group: 'density', description: 'Small buttons and inputs height' },
  'control-height': { group: 'density', description: 'Buttons and inputs height' },

  'shadow-small': { group: 'elevation', description: 'Buttons, inputs, cards' },
  'shadow-medium': { group: 'elevation', description: 'Menus, popovers, tooltips' },
  'shadow-large': { group: 'elevation', description: 'Dialogs and sheets' },

  'motion-fast': { group: 'motion', description: 'Hover and press transitions' },
  'motion-normal': { group: 'motion', description: 'Menus, dialogs, sheets' },
  'motion-easing': { group: 'motion', description: 'Easing curve of transitions' },

  // Collaboration: one colour per person (cursors, selections, editing markers), stable per account.
  'presence-0': { group: 'presence', description: 'Presence colour 1 (cursor, selection, editing marker)' },
  'presence-1': { group: 'presence', description: 'Presence colour 2' },
  'presence-2': { group: 'presence', description: 'Presence colour 3' },
  'presence-3': { group: 'presence', description: 'Presence colour 4' },
  'presence-4': { group: 'presence', description: 'Presence colour 5' },
  'presence-5': { group: 'presence', description: 'Presence colour 6' },
  'presence-6': { group: 'presence', description: 'Presence colour 7' },
  'presence-7': { group: 'presence', description: 'Presence colour 8' },
} as const satisfies Record<string, TokenInfo>;

export type TokenName = keyof typeof TOKENS;
export type TokenValues = Record<TokenName, string>;

export const TOKEN_NAMES = Object.keys(TOKENS) as TokenName[];

export function cssVarName(token: TokenName): `--dbk-${TokenName}` {
  return `--dbk-${token}`;
}

/** `var(--dbk-<token>)`, for inline styles and CSS-in-TS. */
export function cssVar(token: TokenName): string {
  return `var(${cssVarName(token)})`;
}
