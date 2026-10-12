import type { CSSProperties } from 'react';

/**
 * Type sizes of everything drawn on the canvas, in canvas pixels, and the zoom the map opens at.
 * They are chosen together so that at the opening zoom a system name reads at 13 px or more on
 * screen, secondary text (pills, chips, bookmark tags) at 11.5 px or more and connection badges at
 * 11 px or more; a test holds them to it. The canvas hands them to its CSS as custom properties.
 */
export const MAP_TYPE = {
  name: 15,
  secondary: 13,
  edge: 12.5,
  bookmark: 13,
  /** Framed chips above and below a system: labels, the bookmark code, the nearest hub. */
  chip: 14,
} as const;

/** The one zoom the map opens at (a saved view keeps its own). */
export const DEFAULT_ZOOM = 0.9;

/** Smallest effective sizes on screen at the opening zoom, in CSS pixels. */
export const READABLE = { name: 13, secondary: 11.5, edge: 11 } as const;

/** Fit chain never zooms out further than this. */
export const FIT_MIN_ZOOM = 0.5;

/** A size times the theme's map text scale (large-text themes raise it). */
const scaled = (px: number) => `calc(${px}px * var(--dbk-map-text-scale, 1))`;

export const mapTypeVars = {
  '--map-text-name': scaled(MAP_TYPE.name),
  '--map-text-secondary': scaled(MAP_TYPE.secondary),
  '--map-text-edge': scaled(MAP_TYPE.edge),
  '--map-text-bookmark': scaled(MAP_TYPE.bookmark),
  '--map-text-chip': scaled(MAP_TYPE.chip),
} as CSSProperties;
