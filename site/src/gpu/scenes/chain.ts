import { effect, storage } from 'vgpu';
import type { Frame, StorageBuffer } from 'vgpu';
import chainShader from '../shaders/chain.wgsl';
import { camera, fitFocal, project } from '../camera';
import type { Vec3 } from '../camera';
import { clamp01, settle, smoothstep } from '../motion';
import type { Scene, SceneContext, SceneTick } from '../types';

/**
 * Map: the demo chain (apps/server/src/modules/demo/demo-chain.ts) as a 3D scene that assembles
 * as it scrolls into view, home first, then outward one jump at a time, each connection drawing
 * itself from the system it was found from. The DOM labels in the stage follow the systems.
 */

type Rgb = readonly [number, number, number];

const J_SPACE: Rgb = [0.24, 0.32, 1.0];
const HIGH: Rgb = [0.1, 0.85, 0.55];
const LOW: Rgb = [1.0, 0.35, 0.02];
const NULL: Rgb = [1.0, 0.05, 0.04];
const HOME: Rgb = [0.15, 0.85, 0.95];

const FRESH: Rgb = [0.2, 0.23, 0.3];
const EOL: Rgb = [0.48, 0.13, 0.75];
const REDUCED: Rgb = [1.0, 0.5, 0.05];
const CRITICAL: Rgb = [1.0, 0.05, 0.05];
const GATE: Rgb = [0.55, 0.58, 0.64];

const DANGER = 1;
const BUBBLE = 2;
const GATE_FLAG = 4;

// Map positions from the demo seed, in its own units; `lift` gives the chain some depth.
const NODES: { x: number; y: number; lift: number; color: Rgb; size: number; ring: 0 | 1 | 2; order: number }[] = [
  { x: 676, y: 240, lift: 0.5, color: HOME, size: 1.35, ring: 1, order: 0 }, // J014348, home
  { x: 312, y: 240, lift: 0.1, color: J_SPACE, size: 1, ring: 0, order: 1 }, // J130256
  { x: -52, y: 60, lift: 0.7, color: J_SPACE, size: 1.05, ring: 2, order: 4 }, // Pulsar C5, hostile
  { x: -52, y: 450, lift: -0.3, color: NULL, size: 0.9, ring: 0, order: 5 }, // EC-P8R
  { x: 1066, y: 90, lift: 0.3, color: HIGH, size: 1, ring: 0, order: 2 }, // Nourvukaiken
  { x: 1430, y: 90, lift: 0.6, color: LOW, size: 0.85, ring: 0, order: 6 }, // Tama
  { x: 1066, y: 420, lift: -0.2, color: LOW, size: 0.95, ring: 0, order: 3 }, // Amamake
  { x: 1430, y: 300, lift: -0.4, color: J_SPACE, size: 0.85, ring: 0, order: 7 }, // J121158
];

// Connections from the demo seed: [from, to, outer (time), core (mass), width, flags].
const EDGES: [number, number, Rgb, Rgb, number, number][] = [
  [0, 4, FRESH, FRESH, 3.2, 0], // D845 to high-sec
  [0, 6, FRESH, REDUCED, 3.2, 0], // U210 to low-sec, reduced
  [4, 5, GATE, GATE, 1.6, GATE_FLAG], // stargate
  [1, 0, EOL, FRESH, 3.2, 0], // O477, end of life
  [1, 2, FRESH, CRITICAL, 3.2, DANGER], // D364, critical and dangerous
  [1, 3, FRESH, FRESH, 2.0, BUBBLE], // frigate hole, bubbled on the EC-P8R side
  [4, 7, FRESH, FRESH, 3.2, 0], // N110
];

const SEGMENTS = 12;
const MAX_NODES = 8;
const MAX_EDGES = 7;
const FLOATS = (MAX_NODES * 3 + MAX_EDGES * 2 + EDGES.length * SEGMENTS * 2) * 4;

const world = (n: (typeof NODES)[number]): Vec3 => [(n.x - 689) / 95, n.lift, (n.y - 255) / 95];

export function create({ gpu, surface, stage }: SceneContext): Scene {
  const data = new Float32Array(FLOATS);
  const buffer: StorageBuffer & { destroy?: () => void } = storage(gpu, data.byteLength, 'read');
  const fx = effect(gpu, chainShader, { label: 'chain', set: { data: buffer } });
  const labels = [...stage.querySelectorAll<HTMLElement>('.chain-label')];
  const points = NODES.map(world);

  return {
    still: { time: 5, progress: 0.62 },
    dispose() {
      buffer.destroy?.();
    },
    render(f: Frame, tick: SceneTick) {
      const [w, h] = surface.size;
      const aspect = w / Math.max(1, h);
      const narrow = aspect < 1.1;
      const unit = h / 700;

      // Scroll assembles the chain and swings the camera through a few degrees.
      const build = smoothstep(0.12, 0.5, tick.progress);
      const presence = settle(tick.time, 0, 1);
      const yaw = (narrow ? 1.25 : -0.32) + (tick.progress - 0.5) * 0.5 + tick.pointer.x * 0.18 + Math.sin(tick.time * 0.11) * 0.03;
      const pitch = (narrow ? 0.85 : 0.62) - tick.pointer.y * 0.08;
      const cam = camera([0.6, 0, 0], yaw, pitch, 14);
      const focal = fitFocal(cam, points, aspect, narrow ? 0.8 : 0.84, 0.62);
      cam.focal = focal;

      // Nodes.
      const nodeAppear = NODES.map((n) => clamp01((build * (NODES.length + 1) - n.order) / 1.2));
      const projected = points.map((p) => project(cam, p, w, h));
      NODES.forEach((n, i) => {
        const p = projected[i]!;
        const depthScale = 14 / Math.max(4, p.z);
        const o = i * 12;
        data[o] = p.x;
        data[o + 1] = p.y;
        data[o + 2] = 11 * n.size * unit * depthScale;
        data[o + 3] = nodeAppear[i]!;
        data.set(n.color, o + 4);
        data[o + 7] = n.ring;
        data[o + 8] = Math.min(1.2, depthScale);
        // Bubble marker on EC-P8R, offset toward the connection it sits on.
        const bubbled = i === 3;
        data[o + 9] = bubbled ? 1 : 0;
        if (bubbled) {
          const from = projected[1]!;
          const dx = from.x - p.x;
          const dy = from.y - p.y;
          const len = Math.hypot(dx, dy) || 1;
          data[o + 10] = (dx / len) * 22 * unit;
          data[o + 11] = (dy / len) * 22 * unit;
        } else {
          data[o + 10] = 0;
          data[o + 11] = 0;
        }
      });

      // Edge styles.
      const styleBase = MAX_NODES * 12;
      EDGES.forEach(([, , outer, core, width, flags], e) => {
        const o = styleBase + e * 8;
        data.set(outer, o);
        data[o + 3] = width;
        data.set(core, o + 4);
        data[o + 7] = flags;
      });

      // Segments: each connection a gentle arc above the plane, drawn once both ends exist.
      const segBase = styleBase + MAX_EDGES * 8;
      let s = 0;
      EDGES.forEach(([x, y], e) => {
        // Drawn from the system that was there first toward the one it found.
        const [from, to] = NODES[x]!.order <= NODES[y]!.order ? [x, y] : [y, x];
        const a = points[from]!;
        const b = points[to]!;
        const reveal = clamp01((build * (NODES.length + 1) - NODES[to]!.order + 0.5) / 1.1);
        const lift = Math.hypot(b[0] - a[0], b[2] - a[2]) * 0.12;
        let prev = project(cam, a, w, h);
        for (let k = 1; k <= SEGMENTS; k++) {
          const t = k / SEGMENTS;
          const arc = Math.sin(t * Math.PI) * lift;
          const p = project(cam, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + arc, a[2] + (b[2] - a[2]) * t], w, h);
          const o = segBase + s * 8;
          data[o] = prev.x;
          data[o + 1] = prev.y;
          data[o + 2] = p.x;
          data[o + 3] = p.y;
          data[o + 4] = (k - 1) / SEGMENTS;
          data[o + 5] = t;
          data[o + 6] = e;
          data[o + 7] = reveal;
          prev = p;
          s++;
        }
      });

      buffer.write(data.buffer as ArrayBuffer);
      fx.set({
        cfg: {
          frame: [w, h, surface.dpr, tick.time],
          eye: [...cam.eye, cam.focal],
          right: [...cam.right, presence],
          up: [...cam.up, 0],
          fwd: [...cam.fwd, 0],
          counts: [NODES.length, s, unit, -1.2],
        },
      });
      f.pass({ target: surface, clear: [0, 0, 0, 1] }, (p) => p.draw(fx));

      // Labels follow their systems, in CSS pixels.
      const dpr = surface.dpr;
      labels.forEach((label, i) => {
        const p = projected[i];
        if (!p) return;
        const r = data[i * 12 + 2]! / dpr;
        label.style.transform = `translate3d(calc(${(p.x / dpr).toFixed(1)}px - 50%), ${(p.y / dpr + r + 10).toFixed(1)}px, 0)`;
        label.style.opacity = String(smoothstep(0.4, 1, nodeAppear[i]!) * presence);
      });
    },
  };
}
