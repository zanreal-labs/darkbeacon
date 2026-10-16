/**
 * Pointer tracking for a stage, after the hero stage on zanreal.com: PointerEvents only, so a
 * mouse, a pen and a finger take one path; listened to on the stage's section rather than the
 * canvas (which is `pointer-events: none`), so the copy and buttons over it keep every click;
 * no capture and no `touch-action`, so a finger still scrolls the page. Smoothed here, frame-rate
 * independent, so every scene gets the same weight of inertia.
 */

export interface Pointer {
  /** -1..1 across the stage from its centre, smoothed. y grows downward. */
  readonly x: number;
  readonly y: number;
  /** 0 with nothing pointing, easing to 1 while something is. */
  readonly influence: number;
  update(dt: number): void;
  dispose(): void;
}

const POSITION_TAU = 0.35;
const RISE_TAU = 0.25;
const FALL_TAU = 0.9;

const approach = (current: number, target: number, dt: number, tau: number) =>
  current + (target - current) * (1 - Math.exp(-dt / Math.max(1e-4, tau)));

const clamp = (v: number) => Math.min(1, Math.max(-1, v));

export function installPointer(stage: HTMLElement): Pointer {
  const host: HTMLElement = stage.closest<HTMLElement>('[data-stage-host]') ?? stage;
  let x = 0;
  let y = 0;
  let targetX = 0;
  let targetY = 0;
  let influence = 0;
  let engaged = false;

  const onMove = (event: PointerEvent) => {
    if (!event.isPrimary) return;
    const rect = stage.getBoundingClientRect();
    targetX = clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1);
    targetY = clamp(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
    engaged = true;
  };
  const onLeave = () => {
    engaged = false;
  };

  host.addEventListener('pointermove', onMove, { passive: true });
  host.addEventListener('pointerdown', onMove, { passive: true });
  host.addEventListener('pointerleave', onLeave);
  host.addEventListener('pointercancel', onLeave);

  return {
    get x() {
      return x;
    },
    get y() {
      return y;
    },
    get influence() {
      return influence;
    },
    update(dt: number) {
      // With nothing pointing, drift home so the composition re-centres.
      const tx = engaged ? targetX : 0;
      const ty = engaged ? targetY : 0;
      x = approach(x, tx, dt, POSITION_TAU);
      y = approach(y, ty, dt, POSITION_TAU);
      influence = approach(influence, engaged ? 1 : 0, dt, engaged ? RISE_TAU : FALL_TAU);
    },
    dispose() {
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerdown', onMove);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('pointercancel', onLeave);
    },
  };
}

export const parkedPointer: Pointer = {
  x: 0,
  y: 0,
  influence: 0,
  update() {},
  dispose() {},
};
