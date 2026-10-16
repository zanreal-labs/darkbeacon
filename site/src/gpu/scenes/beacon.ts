import { effect, sampler, target } from 'vgpu';
import type { Frame, Target } from 'vgpu';
import beaconShader from '../shaders/beacon.wgsl';
import compositeShader from '../shaders/beacon-composite.wgsl';
import brightShader from '../shaders/post/bright.wgsl';
import blurShader from '../shaders/post/blur.wgsl';
import { settle, smoothstep } from '../motion';
import type { Scene, SceneContext, SceneTick } from '../types';

/**
 * The hero: the Darkbeacon mark as a lit object. A black hole whose accretion ring is the
 * mark's ring, a jet that is its beacon, over a floor that catches the light.
 *
 * Passes: the bent-ray trace into a half-resolution HDR target; a bright pass and two
 * separable blurs for bloom at a quarter; a composite onto the canvas that adds the bloom,
 * the lit dust and the film finish.
 *
 * The entrance builds the mark the way the eye would find it: the photon ring ignites first,
 * the plasma spins up from the inside out, the beacon fires, and only then does its light reach
 * the floor and the sky. 1.8 s end to end. Scrolling away dollies the camera into the hole.
 */

const ENTRANCE = {
  ring: [0.0, 0.7],
  disk: [0.25, 1.5],
  jet: [0.75, 0.8],
  world: [0.5, 1.3],
} as const;

/** Trace resolution as a share of the canvas, at full and at lowest quality. */
const TRACE_SCALE = [0.36, 0.55] as const;

const normalize3 = (v: readonly [number, number, number]) => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l] as const;
};

// The ring faces the viewer and leans right; the beacon leaves along its axis, up and to the
// right like the mark's beam.
const DISK_NORMAL = normalize3([0.5, 0.85, 0.16]);

export function create({ gpu, surface, quality: initialQuality }: SceneContext): Scene {
  let quality = initialQuality;
  const samp = sampler(gpu, { minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

  let targets = makeTargets(surface.size);

  const scene = effect(gpu, beaconShader, {
    label: 'beacon',
    set: {
      params: {
        frame: [targets.trace.size[0], targets.trace.size[1], 0, quality],
        camera: [0, 0.1, 24, 1.7],
        place: [0.5, 0.5, 1, 0],
        entrance: [0, 0, 0, 0],
        jet: [...DISK_NORMAL, 1],
        disk: [...DISK_NORMAL, 0.55],
      },
    },
  });
  const bright = effect(gpu, brightShader, { label: 'beacon-bright' });
  const blurs = [
    { direction: [1, 0], radius: 1 },
    { direction: [0, 1], radius: 1 },
    { direction: [1, 0], radius: 2.6 },
    { direction: [0, 1], radius: 2.6 },
  ].map((b, i) => effect(gpu, blurShader, { label: `beacon-blur-${i}`, set: { samp, blur: { texel: [0, 0], ...b } } }));
  const composite = effect(gpu, compositeShader, { label: 'beacon-composite' });

  const bind = () => {
    bright.set({
      src: targets.trace,
      samp,
      bright: { texel: targets.trace.texelSize, threshold: 0.9, knee: 0.5 },
    });
    blurs.forEach((blur, i) => blur.set({ src: targets.bloom[i % 2]!, blur: { texel: targets.bloom[0].texelSize } }));
    composite.set({ scene: targets.trace, bloom: targets.bloom[0], samp });
  };
  bind();

  function makeTargets(size: readonly [number, number]) {
    // Quality above 1 only comes from the capture tooling, which wants the trace near full size.
    const scale = Math.min(1, TRACE_SCALE[0] + (TRACE_SCALE[1] - TRACE_SCALE[0]) * (quality - 0.5) * 2);
    const w = Math.max(1, Math.round(size[0] * scale));
    const h = Math.max(1, Math.round(size[1] * scale));
    const bw = Math.max(1, Math.round(w / 2));
    const bh = Math.max(1, Math.round(h / 2));
    return {
      trace: target(gpu, { size: [w, h], format: 'rgba16float', label: 'beacon-trace' }),
      bloom: [
        target(gpu, { size: [bw, bh], format: 'rgba16float', label: 'beacon-bloom-a' }),
        target(gpu, { size: [bw, bh], format: 'rgba16float', label: 'beacon-bloom-b' }),
      ] as const,
    };
  }

  const destroyTargets = (t: typeof targets) => {
    for (const x of [t.trace, ...t.bloom] as Target[]) (x as { destroy?: () => void }).destroy?.();
  };

  const rebuild = () => {
    const next = makeTargets(surface.size);
    destroyTargets(targets);
    targets = next;
    bind();
  };

  return {
    still: { time: 9, progress: 0.5 },
    resize: rebuild,
    setQuality(next) {
      quality = next;
      rebuild();
    },
    dispose() {
      destroyTargets(targets);
    },
    render(f: Frame, tick: SceneTick) {
      const [width, height] = surface.size;
      const cssWidth = width / surface.dpr;
      const aspect = width / Math.max(1, height);
      const wide = aspect > 1.15 && cssWidth >= 900;

      // Where the hole sits: right of the copy on wide screens, above it on narrow ones.
      const dive = smoothstep(0.52, 0.98, tick.progress);
      let cx: number;
      let cy: number;
      let scale: number;
      if (wide) {
        cx = 0.82 - dive * 0.22;
        cy = 0.46;
        scale = 0.54;
      } else {
        // Above the copy, a fixed distance under the nav whatever the hero's height.
        const cssHeight = height / surface.dpr;
        cx = 0.52;
        cy = Math.min(0.34, (60 + window.innerHeight * 0.2) / cssHeight) - dive * 0.05;
        scale = Math.min(1, (0.36 * width) / (0.3 * height));
      }

      const t = tick.time;
      const e = (span: readonly [number, number]) => settle(t, span[0], span[1]);
      const entrance = [e(ENTRANCE.ring), e(ENTRANCE.disk), e(ENTRANCE.jet), e(ENTRANCE.world)];

      const yaw = -0.12 + tick.pointer.x * 0.2 + Math.sin(t * 0.07) * 0.04;
      const pitch = 0.11 - tick.pointer.y * 0.05 + dive * 0.32;
      const distance = 24 - dive * 10;

      scene.set({
        params: {
          frame: [targets.trace.size[0], targets.trace.size[1], t, quality],
          camera: [yaw, pitch, distance, 1.7],
          place: [cx, cy, scale, 0],
          entrance,
        },
      });
      composite.set({
        cfg: {
          frame: [width, height, surface.dpr, t],
          place: [cx, cy, scale, entrance[3]!],
          look: [tick.pointer.x, tick.pointer.y, 0.85, 1.05],
          edges: [0.08, wide ? 0.3 : 0.22, 1, 0],
        },
      });

      f.pass({ target: targets.trace, clear: [0, 0, 0, 1] }, (p) => p.draw(scene));
      f.pass({ target: targets.bloom[0], clear: [0, 0, 0, 1] }, (p) => p.draw(bright));
      blurs.forEach((blur, i) => {
        f.pass({ target: targets.bloom[(i + 1) % 2]!, clear: [0, 0, 0, 1] }, (p) => p.draw(blur));
      });
      f.pass({ target: surface, clear: [0, 0, 0, 1] }, (p) => p.draw(composite));
    },
  };
}
