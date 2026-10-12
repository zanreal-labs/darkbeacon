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
  | 'motion';

export interface TokenInfo {
  group: TokenGroup;
  description: string;
}

/**
 * Every themeable value. Components read them as CSS custom properties (`--ww-<name>`);
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

  'node-bg': { group: 'node', description: 'System node background' },
  'node-border': { group: 'node', description: 'System node border' },
  'node-text': { group: 'node', description: 'System node text' },
  'node-selected-border': { group: 'node', description: 'Selected node border' },
  'node-radius': { group: 'node', description: 'Node corner radius' },
  'node-border-width': { group: 'node', description: 'Node border width' },
  'node-min-width': { group: 'node', description: 'Node minimum width' },
  'node-padding': { group: 'node', description: 'Node inner padding' },

  'edge-width': { group: 'edge', description: 'Connection stroke width' },
  'edge-color': { group: 'edge', description: 'Wormhole connection, fresh' },
  'edge-gate': { group: 'edge', description: 'Stargate connection' },
  'edge-bridge': { group: 'edge', description: 'Jump bridge connection' },
  'edge-time-eol': { group: 'edge', description: 'End of life (< 4 h) connection' },
  'edge-mass-reduced': { group: 'edge', description: 'Mass reduced (10-50 %)' },
  'edge-mass-critical': { group: 'edge', description: 'Mass critical (< 10 %)' },
  'edge-dangerous': { group: 'edge', description: 'Underlay of a dangerous connection' },
  'edge-bubble': { group: 'edge', description: 'Bubble marker at a bubbled end' },
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
} as const satisfies Record<string, TokenInfo>;

export type TokenName = keyof typeof TOKENS;
export type TokenValues = Record<TokenName, string>;

export const TOKEN_NAMES = Object.keys(TOKENS) as TokenName[];

export function cssVarName(token: TokenName): `--ww-${TokenName}` {
  return `--ww-${token}`;
}

/** `var(--ww-<token>)`, for inline styles and CSS-in-TS. */
export function cssVar(token: TokenName): string {
  return `var(${cssVarName(token)})`;
}
