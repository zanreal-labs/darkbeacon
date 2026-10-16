/**
 * Pixel budgets, after `sim-sizing.ts` on zanreal.com: the device pixel ratio each canvas runs
 * at is a function of its CSS size, so a 2560-wide display does not shade four times what a
 * laptop does. Every scene here is a soft, glowing picture; past ~1.5x nobody can see the
 * difference, and below ~0.75x the browser's upscale starts to show.
 */

const MAX_DPR = 1.5;
const MIN_DPR = 0.75;

/** The device pixel ratio for a canvas of this CSS size, inside `budget` presented pixels. */
export function dprCap(cssWidth: number, cssHeight: number, budget: number): number {
  const pixels = Math.max(1, cssWidth) * Math.max(1, cssHeight);
  const fit = Math.sqrt(budget / pixels);
  const device = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  return Math.min(MAX_DPR, device, Math.max(MIN_DPR, fit));
}

/** Presented-pixel budgets per scene: ~1080p for the hero, less for the scenes below it. */
export const BUDGET = {
  beacon: 2_100_000,
  transit: 1_200_000,
  probes: 700_000,
  chain: 1_400_000,
  jump: 1_400_000,
} as const;
