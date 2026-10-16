export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * A smootherstep from `delay` over `span` seconds: zero first and second derivative at both
 * ends, so a stage that runs for most of a second arrives without a visible corner.
 */
export const settle = (time: number, delay: number, span: number) => {
  const t = clamp01((time - delay) / span);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
