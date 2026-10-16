import { effect, storage } from 'vgpu';
import type { Frame, StorageBuffer } from 'vgpu';
import jumpShader from '../shaders/jump.wgsl';
import { camera, fitFocal, project } from '../camera';
import type { Vec3 } from '../camera';
import { clamp01, settle, smoothstep } from '../motion';
import type { Scene, SceneContext, SceneTick } from '../types';

/**
 * Capitals: the route from the copied example above (Amamake to 1DQ1-A, 8 jumps) flown leg by
 * leg as the section scrolls through. The map is stylised: the systems' places are drawn for
 * the picture, not taken from the game's coordinates.
 */

// Nine systems on the plane: Amamake, Fasse, Ahbazon, Noranim, four more, 1DQ1-A.
const ROUTE: [number, number][] = [
  [-7.6, -1.2],
  [-5.4, 1.0],
  [-3.2, -0.3],
  [-1.0, 1.3],
  [1.1, -0.1],
  [3.0, 1.5],
  [4.8, 0.1],
  [6.3, 1.4],
  [8.0, 0.3],
];
const LEG_SEGMENTS = 14;
const BEAM_SEGMENTS = 1;
const MAX_SYSTEMS = 9;
const LEGS = ROUTE.length - 1;
const SEGMENTS = LEGS * LEG_SEGMENTS + ROUTE.length * BEAM_SEGMENTS;
const FLOATS = (MAX_SYSTEMS + SEGMENTS * 2) * 4;
const RANGE = 2.9;

export function create({ gpu, surface, stage }: SceneContext): Scene {
  const data = new Float32Array(FLOATS);
  const buffer: StorageBuffer & { destroy?: () => void } = storage(gpu, data.byteLength, 'read');
  const fx = effect(gpu, jumpShader, { label: 'jump', set: { data: buffer } });
  const from = stage.querySelector<HTMLElement>('[data-end="from"]');
  const to = stage.querySelector<HTMLElement>('[data-end="to"]');
  const points: Vec3[] = ROUTE.map(([x, z]) => [x, 0, z]);
  const framing: Vec3[] = [...points, [-8, 1.6, 0], [8.5, 1.6, 0]];

  return {
    still: { time: 6, progress: 0.72 },
    dispose() {
      buffer.destroy?.();
    },
    render(f: Frame, tick: SceneTick) {
      const [w, h] = surface.size;
      const aspect = w / Math.max(1, h);
      const narrow = aspect < 1.1;
      const unit = h / 700;
      const presence = settle(tick.time, 0, 1.2);

      // The flight: legs land one after another across the middle of the scroll.
      const flight = smoothstep(0.18, 0.72, tick.progress) * LEGS;
      const yaw = (narrow ? 0.95 : 0.12) + (tick.progress - 0.5) * 0.35 + tick.pointer.x * 0.15;
      const pitch = (narrow ? 1.05 : 0.78) - tick.pointer.y * 0.08;
      const cam = camera([0.2, 0, 0.1], yaw, pitch, 15);
      cam.focal = fitFocal(cam, framing, aspect, narrow ? 0.86 : 0.9, 0.7);

      const current = Math.min(LEGS, Math.floor(flight));
      ROUTE.forEach(([x, z], i) => {
        const o = i * 4;
        data[o] = x;
        data[o + 1] = z;
        // A cyno is lit at a system once the leg toward it has landed.
        data[o + 2] = i === 0 ? 0 : smoothstep(i - 0.15, i, flight) * (0.7 + 0.3 * Math.sin(tick.time * 3 + i));
        data[o + 3] = i === current ? 1 : 0;
      });

      let s = 0;
      const base = MAX_SYSTEMS * 4;
      const write = (a: { x: number; y: number }, b: { x: number; y: number }, t0: number, t1: number, kind: number, reveal: number) => {
        const o = base + s * 8;
        data[o] = a.x;
        data[o + 1] = a.y;
        data[o + 2] = b.x;
        data[o + 3] = b.y;
        data[o + 4] = t0;
        data[o + 5] = t1;
        data[o + 6] = kind;
        data[o + 7] = reveal;
        s++;
      };
      for (let leg = 0; leg < LEGS; leg++) {
        const a = points[leg]!;
        const b = points[leg + 1]!;
        const reveal = clamp01(flight - leg);
        const height = Math.hypot(b[0] - a[0], b[2] - a[2]) * 0.35;
        let prev = project(cam, a, w, h);
        for (let k = 1; k <= LEG_SEGMENTS; k++) {
          const t = k / LEG_SEGMENTS;
          const p = project(cam, [a[0] + (b[0] - a[0]) * t, Math.sin(t * Math.PI) * height, a[2] + (b[2] - a[2]) * t], w, h);
          write(prev, p, (k - 1) / LEG_SEGMENTS, t, 0, reveal);
          prev = p;
        }
      }
      points.forEach((p, i) => {
        const lit = i === 0 ? 0 : smoothstep(i - 0.1, i + 0.25, flight);
        const bottom = project(cam, p, w, h);
        const top = project(cam, [p[0], 1.3, p[2]], w, h);
        write(bottom, top, 0, 1, 1 + i, lit);
      });

      buffer.write(data.buffer as ArrayBuffer);
      fx.set({
        cfg: {
          frame: [w, h, surface.dpr, tick.time],
          eye: [...cam.eye, cam.focal],
          right: [...cam.right, presence],
          up: [...cam.up, 0],
          fwd: [...cam.fwd, 0],
          counts: [ROUTE.length, s, unit, RANGE],
        },
      });
      f.pass({ target: surface, clear: [0, 0, 0, 1] }, (p) => p.draw(fx));

      const dpr = surface.dpr;
      const place = (el: HTMLElement | null, p: Vec3, show: number) => {
        if (!el) return;
        const q = project(cam, p, w, h);
        el.style.transform = `translate3d(calc(${(q.x / dpr).toFixed(1)}px - 50%), ${(q.y / dpr + 14).toFixed(1)}px, 0)`;
        el.style.opacity = String(show * presence);
      };
      place(from, points[0]!, 1);
      place(to, points[LEGS]!, smoothstep(LEGS - 0.4, LEGS, flight));
    },
  };
}
