import type { ConnectionDto, ShipSize } from '@darkbeacon/shared';
import { cssVar, type TokenName } from '@darkbeacon/theme-sdk';

/**
 * The connection visual language, built for a glance in combat: a healthy wormhole is a calm
 * plain line and only exceptions shout. Each property has its own channel, so they combine and
 * survive colour blindness:
 * - mass is COLOUR (neutral, amber, red; critical also a little thicker),
 * - time is PATTERN (solid, EOL dashed),
 * - size is THICKNESS (frigate thin, medium, large default, XL thick),
 * - danger is a red HALO around the whole line, bubbles are big circles on the bubbled ends,
 * - gates are solid neutral with a gate icon, Ansiblex bridges dotted lime.
 * Badges appear only for states that are not the default, at most two, most urgent first.
 */

export type EdgeBadgeKind =
  'gate' | 'bridge' | 'dangerous' | 'eol' | 'critical' | 'frigate' | 'reduced' | 'medium' | 'capital';

export interface EdgeBadge {
  kind: EdgeBadgeKind;
  /** Short text on the line; icon badges (gate, bridge, dangerous) have a label for screen readers. */
  label: string;
  /** Spelled out, for the tooltip. */
  title: string;
}

export interface EdgeVisual {
  stroke: TokenName;
  /** Multiple of `--dbk-edge-width`. */
  width: number;
  /** EOL is dashed, bridges are dotted, everything else solid. */
  dash: 'eol' | 'dotted' | null;
  halo: boolean;
  bubbles: ('source' | 'target')[];
  /** At most two, most urgent first. */
  badges: EdgeBadge[];
  /** Every non-default state, most urgent first: the tooltip's lines. */
  states: EdgeBadge[];
}

export const MAX_EDGE_BADGES = 2;
/** EOL means under four hours of life left (https://wiki.eveuniversity.org/Wormhole_attributes). */
export const EOL_WINDOW_MS = 4 * 60 * 60_000;

const SIZE_WIDTH: Record<ShipSize, number> = { small: 0.5, medium: 0.75, large: 1, xlarge: 1.7 };
const CRITICAL_EXTRA = 1.3;

export const SHIP_SIZE_TEXT: Record<ShipSize, string> = {
  small: 'Frigates and destroyers only',
  medium: 'Up to battlecruisers and industrials',
  large: 'Up to battleships',
  xlarge: 'Capitals and freighters',
};

/** "~2h10m" of an EOL wormhole's life left, from when it was marked; null when not known. */
export function eolRemaining(eolAt: number | null, now: number): string | null {
  if (eolAt === null) return null;
  const minutes = Math.max(0, Math.floor((EOL_WINDOW_MS - (now - eolAt)) / 60_000));
  if (minutes < 60) return `~${minutes}m`;
  const rest = minutes % 60;
  return `~${Math.floor(minutes / 60)}h${rest ? `${String(rest).padStart(2, '0')}m` : ''}`;
}

export function edgeVisual(c: ConnectionDto, now = Date.now()): EdgeVisual {
  const states: EdgeBadge[] = [];
  const wormhole = c.type === 'wormhole';
  if (c.type === 'gate') states.push({ kind: 'gate', label: 'Gate', title: 'Stargate' });
  if (c.type === 'bridge') states.push({ kind: 'bridge', label: 'JB', title: 'Ansiblex jump bridge' });
  if (c.dangerous)
    states.push({ kind: 'dangerous', label: 'Dangerous', title: 'Dangerous: hostiles on the other side' });
  if (wormhole && c.timeStatus === 'eol') {
    const left = eolRemaining(c.eolAt, now);
    states.push({
      kind: 'eol',
      label: left ? `EOL ${left}` : 'EOL',
      title: left ? `End of life: about ${left.slice(1)} left` : 'End of life: under 4 hours left',
    });
  }
  if (wormhole && c.massStatus === 'critical')
    states.push({ kind: 'critical', label: 'Crit', title: 'Mass critical: under 10 % left' });
  if (wormhole && c.shipSize === 'small')
    states.push({ kind: 'frigate', label: 'F', title: SHIP_SIZE_TEXT.small });
  if (wormhole && c.massStatus === 'reduced')
    states.push({ kind: 'reduced', label: 'Half', title: 'Mass reduced: 10 to 50 % left' });
  if (wormhole && c.shipSize === 'medium')
    states.push({ kind: 'medium', label: 'M', title: SHIP_SIZE_TEXT.medium });
  if (wormhole && c.shipSize === 'xlarge')
    states.push({ kind: 'capital', label: 'XL', title: SHIP_SIZE_TEXT.xlarge });

  const stroke: TokenName =
    c.type === 'gate'
      ? 'edge-gate'
      : c.type === 'bridge'
        ? 'edge-bridge'
        : c.massStatus === 'critical'
          ? 'edge-mass-critical'
          : c.massStatus === 'reduced'
            ? 'edge-mass-reduced'
            : 'edge-color';
  const width = wormhole ? SIZE_WIDTH[c.shipSize] * (c.massStatus === 'critical' ? CRITICAL_EXTRA : 1) : 1;
  return {
    stroke,
    width,
    dash: c.type === 'bridge' ? 'dotted' : wormhole && c.timeStatus === 'eol' ? 'eol' : null,
    halo: c.dangerous,
    bubbles: [
      ...(c.bubbled === 'source' || c.bubbled === 'both' ? (['source'] as const) : []),
      ...(c.bubbled === 'target' || c.bubbled === 'both' ? (['target'] as const) : []),
    ],
    badges: states.slice(0, MAX_EDGE_BADGES),
    states,
  };
}

/** Inline style of the line itself; the legend draws its samples with the same function. */
export function edgeLineStyle(v: EdgeVisual): {
  stroke: string;
  strokeWidth: string;
  strokeDasharray?: string;
  strokeLinecap: 'round' | 'butt';
} {
  const width = `calc(var(--dbk-edge-width) * ${v.width})`;
  const times = (n: number) => `calc(var(--dbk-edge-width) * ${+(v.width * n).toFixed(2)})`;
  return {
    stroke: cssVar(v.stroke),
    strokeWidth: width,
    ...(v.dash === 'eol' ? { strokeDasharray: `${times(3.2)} ${times(2.2)}` } : {}),
    ...(v.dash === 'dotted' ? { strokeDasharray: `0.01 ${times(2.4)}` } : {}),
    strokeLinecap: v.dash === 'dotted' ? 'round' : 'butt',
  };
}
