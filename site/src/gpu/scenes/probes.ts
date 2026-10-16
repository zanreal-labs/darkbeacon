import { effect } from 'vgpu';
import type { Frame } from 'vgpu';
import probesShader from '../shaders/probes.wgsl';
import { mix, settle, smoothstep } from '../motion';
import type { Scene, SceneContext, SceneTick } from '../types';

/**
 * Scan: probes close on a signature in a seven-second cycle (converge, hold at warpable,
 * release), while scrolling swings the camera around the formation.
 */

const CYCLE = 7;

export function create({ gpu, surface }: SceneContext): Scene {
  const fx = effect(gpu, probesShader, { label: 'probes' });

  return {
    // Mid-convergence, yellow: the moment that explains the colours best.
    still: { time: 0.62 * CYCLE + 1.2, progress: 0.5 },
    dispose() {},
    render(f: Frame, tick: SceneTick) {
      const [w, h] = surface.size;
      const phase = ((tick.time - 1.2 + CYCLE * 10) % CYCLE) / CYCLE;
      const close = settle(phase, 0, 0.62);
      const release = settle(phase, 0.88, 0.12);
      const spread = mix(mix(7.5, 1.1, close), 7.5, release);
      const strength = Math.max(0, close - release * 1.2);
      const pulse = phase > 0.64 && phase < 0.86 ? ((phase - 0.64) / 0.11) % 1 : 0;
      const presence = settle(tick.time, 0, 1.2);

      const yaw = -0.9 + tick.progress * 1.6 + tick.pointer.x * 0.25;
      const pitch = 0.42 - tick.pointer.y * 0.12 + smoothstep(0.3, 0.8, tick.progress) * 0.1;
      fx.set({
        cfg: {
          frame: [w, h, surface.dpr, tick.time],
          camera: [yaw, pitch, 17, 1.7],
          scan: [spread, strength, pulse, presence],
        },
      });
      f.pass({ target: surface, clear: [0, 0, 0, 1] }, (p) => p.draw(fx));
    },
  };
}
