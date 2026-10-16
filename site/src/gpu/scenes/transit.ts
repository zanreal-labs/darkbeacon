import { effect } from 'vgpu';
import type { Frame } from 'vgpu';
import transitShader from '../shaders/transit.wgsl';
import { settle, smoothstep } from '../motion';
import type { Scene, SceneContext, SceneTick } from '../types';

/**
 * The passages between sections: a wormhole you fly through as you scroll. Scroll position is
 * the flight: the tunnel moves a fixed distance per screen scrolled, so scrolling faster flies
 * faster, and stopping leaves it drifting on its own slow current.
 */

type Rgb = readonly [number, number, number];

interface Mood {
  near: Rgb;
  far: Rgb;
  exit: Rgb;
  twist: number;
  turbulence: number;
  exitSize: number;
  debris: number;
  intensity: number;
}

// Linear colours. Enter: the beacon and the wormhole blue. Fight: the hostile red of a
// critical, dangerous connection over violet. Exit: back into the light.
const MOODS: Record<string, Mood> = {
  enter: {
    near: [0.05, 0.42, 0.55],
    far: [0.24, 0.26, 0.95],
    exit: [0.7, 0.92, 1.0],
    twist: 0.9,
    turbulence: 0.8,
    exitSize: 0.03,
    debris: 0.8,
    intensity: 1,
  },
  fight: {
    near: [0.7, 0.05, 0.06],
    far: [0.38, 0.08, 0.6],
    exit: [1.0, 0.55, 0.45],
    twist: 1.6,
    turbulence: 1.5,
    exitSize: 0.024,
    debris: 1.2,
    intensity: 1,
  },
  // Sponsor: the warm gold of ISK around the beacon's cyan.
  sponsor: {
    near: [0.75, 0.42, 0.08],
    far: [0.12, 0.42, 0.6],
    exit: [1.0, 0.86, 0.6],
    twist: 0.7,
    turbulence: 0.7,
    exitSize: 0.035,
    debris: 0.6,
    intensity: 0.7,
  },
  exit: {
    near: [0.1, 0.5, 0.62],
    far: [0.3, 0.32, 1.0],
    exit: [0.85, 0.97, 1.0],
    twist: 0.5,
    turbulence: 0.6,
    exitSize: 0.05,
    debris: 0.5,
    intensity: 0.9,
  },
};

export function create({ gpu, surface, stage }: SceneContext): Scene {
  const mood = MOODS[stage.dataset.mood ?? 'enter'] ?? MOODS.enter!;
  const fx = effect(gpu, transitShader, { label: `transit-${stage.dataset.mood}` });

  return {
    still: { time: 4, progress: 0.5 },
    dispose() {},
    render(f: Frame, tick: SceneTick) {
      const [w, h] = surface.size;
      // Fade in as it arrives, and swell through the middle of the passage.
      const arrive = settle(tick.time, 0, 1.2);
      const presence = smoothstep(0.05, 0.4, tick.progress) * (1 - smoothstep(0.75, 1, tick.progress) * 0.6);
      const travel = tick.progress * 6 + tick.time * 0.05;
      fx.set({
        cfg: {
          frame: [w, h, surface.dpr, tick.time],
          flight: [travel, mood.twist, mood.turbulence, mood.intensity * arrive * (0.35 + 0.65 * presence)],
          near: [...mood.near, mood.exitSize],
          far: [...mood.far, 0],
          exit: [...mood.exit, mood.debris],
          // The exit sits above the words, so its light frames the heading instead of sitting on it.
          view: [0.5, 0.2, tick.pointer.x, tick.pointer.y],
        },
      });
      f.pass({ target: surface, clear: [0, 0, 0, 1] }, (p) => p.draw(fx));
    },
  };
}
