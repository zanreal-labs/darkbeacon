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

export const mapTypeVars = {
  '--map-text-name': `${MAP_TYPE.name}px`,
  '--map-text-secondary': `${MAP_TYPE.secondary}px`,
  '--map-text-edge': `${MAP_TYPE.edge}px`,
  '--map-text-bookmark': `${MAP_TYPE.bookmark}px`,
  '--map-text-chip': `${MAP_TYPE.chip}px`,
} as CSSProperties;
