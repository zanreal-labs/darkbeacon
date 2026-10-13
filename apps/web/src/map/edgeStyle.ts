import type { ConnectionDto, ShipSize } from '@darkbeacon/shared';
import { cssVar, type TokenName } from '@darkbeacon/theme-sdk';

/**
 * The connection visual language, read from colour alone in combat. Every connection is the same
 * thick two-layer line:
 * - the OUTER layer is TIME: normal neutral, end of life purple, under an hour left pink;
 * - the INNER core is MASS: fresh neutral, reduced amber, critical red;
 * - a red HALO beyond the line is danger;
 * - a big circle on the line just outside a system is a bubble on that side;
 * - Ansiblex bridges are one dotted lime line, gates a plain neutral one.
 * Ship size is never the width: a size other than large carries only a small letter at the
 * midpoint (S, M, XL, C), the one text ever drawn on a connection. Everything else is in the
 * hover card and the Connections panel.
 */

export type EdgeTime = 'normal' | 'eol' | 'critical';

export interface EdgeState {
  kind: 'dangerous' | 'eol' | 'timeCritical' | 'critical' | 'reduced' | 'size' | 'saved';
  /** Spelled out, for the hover card. */
  title: string;
}

export interface EdgeVisual {
  /** Outer layer colour: the time state (or the gate/bridge colour). */
  outer: TokenName;
  /** Inner core colour: the mass state; null for gates and bridges (one layer). */
  inner: TokenName | null;
  time: EdgeTime;
  /** Bridges are dotted. */
  dotted: boolean;
  halo: boolean;
  bubbles: ('source' | 'target')[];
  /** The size letter at the midpoint; null for large holes, gates and bridges. */
  size: string | null;
  /** Every non-default state, most urgent first: the hover card's lines. */
  states: EdgeState[];
}

/** EOL means under four hours of life left (https://wiki.eveuniversity.org/Wormhole_attributes). */
export const EOL_WINDOW_MS = 4 * 60 * 60_000;
/** Under this much life left, the outer layer turns from EOL purple to critical pink. */
export const TIME_CRITICAL_MS = 60 * 60_000;
/** The core's share of the line's width. */
export const INNER_SHARE = 0.34;

export const SHIP_SIZE_LETTER: Record<ShipSize, string | null> = {
  small: 'S',
  medium: 'M',
  large: null,
  xlarge: 'XL',
  capital: 'C',
};

export const SHIP_SIZE_TEXT: Record<ShipSize, string> = {
  small: 'Frigates and destroyers only',
  medium: 'Up to battlecruisers and industrials',
  large: 'Up to battleships',
  xlarge: 'Up to freighters',
  capital: 'Capitals',
};

/** Milliseconds of an EOL wormhole's life left, from when it was marked; null when not known. */
export function eolLeftMs(eolAt: number | null, now: number): number | null {
  if (eolAt === null) return null;
  return Math.max(0, EOL_WINDOW_MS - (now - eolAt));
}

/** "~2h10m" of an EOL wormhole's life left, from when it was marked; null when not known. */
export function eolRemaining(eolAt: number | null, now: number): string | null {
  const left = eolLeftMs(eolAt, now);
  if (left === null) return null;
  const minutes = Math.floor(left / 60_000);
  if (minutes < 60) return `~${minutes}m`;
  const rest = minutes % 60;
  return `~${Math.floor(minutes / 60)}h${rest ? `${String(rest).padStart(2, '0')}m` : ''}`;
}

export function edgeVisual(c: ConnectionDto, now = Date.now()): EdgeVisual {
  const wormhole = c.type === 'wormhole';
  const states: EdgeState[] = [];
  if (c.dangerous) states.push({ kind: 'dangerous', title: 'Dangerous: hostiles on the other side' });

  let time: EdgeTime = 'normal';
  if (wormhole && c.timeStatus === 'eol') {
    const leftMs = eolLeftMs(c.eolAt, now);
    const left = eolRemaining(c.eolAt, now);
    time = leftMs !== null && leftMs < TIME_CRITICAL_MS ? 'critical' : 'eol';
    states.push(
      time === 'critical'
        ? { kind: 'timeCritical', title: `Under an hour left (about ${left!.slice(1)})` }
        : {
            kind: 'eol',
            title: left ? `End of life: about ${left.slice(1)} left` : 'End of life: under 4 hours left',
          },
    );
  }
  if (wormhole && c.massStatus === 'critical')
    states.push({ kind: 'critical', title: 'Mass critical: under 10 % left' });
  if (wormhole && c.massStatus === 'reduced')
    states.push({ kind: 'reduced', title: 'Mass reduced: 10 to 50 % left' });
  const size = wormhole ? SHIP_SIZE_LETTER[c.shipSize] : null;
  if (wormhole && size) states.push({ kind: 'size', title: SHIP_SIZE_TEXT[c.shipSize] });
  if (wormhole && c.massSaved) states.push({ kind: 'saved', title: 'Mass saved' });

  const outer: TokenName =
    c.type === 'gate'
      ? 'edge-gate'
      : c.type === 'bridge'
        ? 'edge-bridge'
        : time === 'critical'
          ? 'edge-time-critical'
          : time === 'eol'
            ? 'edge-time-eol'
            : 'edge-color';
  const inner: TokenName | null = !wormhole
    ? null
    : c.massStatus === 'critical'
      ? 'edge-mass-critical'
      : c.massStatus === 'reduced'
        ? 'edge-mass-reduced'
        : 'edge-mass-fresh';
  return {
    outer,
    inner,
    time,
    dotted: c.type === 'bridge',
    halo: c.dangerous,
    bubbles: [
      ...(c.bubbled === 'source' || c.bubbled === 'both' ? (['source'] as const) : []),
      ...(c.bubbled === 'target' || c.bubbled === 'both' ? (['target'] as const) : []),
    ],
    size,
    states,
  };
}

interface LineStyle {
  stroke: string;
  strokeWidth: string;
  strokeDasharray?: string;
  strokeLinecap: 'round' | 'butt';
}

/** The outer layer (the whole line for gates and bridges); the legend draws with it too. */
export function edgeOuterStyle(v: EdgeVisual): LineStyle {
  return {
    stroke: cssVar(v.outer),
    strokeWidth: 'var(--dbk-edge-width)',
    ...(v.dotted ? { strokeDasharray: '0.01 calc(var(--dbk-edge-width) * 1.4)' } : {}),
    strokeLinecap: v.dotted ? 'round' : 'butt',
  };
}

/** The inner core; null for one-layer lines (gates, bridges). */
export function edgeInnerStyle(v: EdgeVisual): LineStyle | null {
  if (!v.inner) return null;
  return {
    stroke: cssVar(v.inner),
    strokeWidth: `calc(var(--dbk-edge-width) * ${INNER_SHARE})`,
    strokeLinecap: 'butt',
  };
}
