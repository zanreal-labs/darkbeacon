import { frame, init, surface } from 'vgpu';
import type { Gpu } from 'vgpu';
import { installPointer, parkedPointer } from './pointer';
import type { Pointer } from './pointer';
import { BUDGET, dprCap } from './sizing';
import type { Scene, SceneBuilder } from './types';

/**
 * One GPU device for the whole page, and one render loop for every scene on it.
 *
 * Each stage on the page (`[data-stage]`) owns a canvas; all of them are surfaces of the same
 * `Gpu`, so the page pays for one adapter, one device and one shader cache however many scenes
 * it shows, and every visible scene is encoded into one frame and one submit.
 *
 * The gates, after the hero stage on zanreal.com:
 * - this module is only fetched after the page has loaded and gone idle, and only where
 *   `navigator.gpu` exists (see `boot.ts`), so none of it is on the critical path;
 * - each scene's code and shaders are a separate chunk, fetched when its stage comes within
 *   600px of the viewport, and never if it does not;
 * - a scene renders only while its stage is on screen and the tab is visible; the loop stops
 *   entirely when nothing is;
 * - `prefers-reduced-motion` gets one settled still per scene and no loop at all;
 * - every canvas runs at a device pixel ratio fitted to a pixel budget (`sizing.ts`);
 * - a scene that has not drawn within 8 visible seconds is given up for its pre-rendered still,
 *   and a lost device gives every stage its still;
 * - when frames run long the runtime lowers quality, which each scene maps to cheaper settings.
 */

const SCENES: Record<string, () => Promise<{ create: SceneBuilder }>> = {
  beacon: () => import('./scenes/beacon'),
  transit: () => import('./scenes/transit'),
  probes: () => import('./scenes/probes'),
  chain: () => import('./scenes/chain'),
  jump: () => import('./scenes/jump'),
};

const NEAR_MARGIN = '600px 0px';
const FIRST_FRAME_TIMEOUT_MS = 8000;
const MAX_DT = 1 / 20;
/** Frame time above which quality steps down, and how long it has to persist. */
const SLOW_FRAME = 1 / 42;
const SLOW_FOR_SECONDS = 1.5;

type State = 'idle' | 'loading' | 'live' | 'failed';

interface Stage {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly name: string;
  state: State;
  near: boolean;
  visible: boolean;
  scene?: Scene;
  pointer: Pointer;
  time: number;
  progress: number;
  dispose?: () => void;
  deadline?: ReturnType<typeof setTimeout>;
}

export interface RuntimeOptions {
  readonly reducedMotion: boolean;
  /** Called when WebGPU turns out not to work at all, so the page can show its fallbacks. */
  readonly onUnavailable: (error: unknown) => void;
  /** Capture mode: no loop; scenes render on demand through `window.__dbk`. */
  readonly capture?: boolean;
}

export async function start(options: RuntimeOptions): Promise<void> {
  const { reducedMotion } = options;
  let gpu: Gpu;
  try {
    gpu = await init({ powerPreference: 'high-performance' });
  } catch (error) {
    options.onUnavailable(error);
    return;
  }

  let quality = 1;
  let slowFor = 0;
  let raf = 0;
  let last = performance.now();
  let dead = false;

  const stages: Stage[] = [...document.querySelectorAll<HTMLElement>('[data-stage]')].flatMap((el) => {
    const canvas = el.querySelector('canvas');
    const name = el.dataset.stage ?? '';
    if (!canvas || !(name in SCENES)) return [];
    return [
      {
        el,
        canvas,
        name,
        state: 'idle' as State,
        near: false,
        visible: false,
        pointer: parkedPointer,
        time: 0,
        progress: measure(el),
      },
    ];
  });

  const setState = (stage: Stage, state: State) => {
    stage.state = state;
    stage.el.dataset.state = state;
  };

  const failStage = (stage: Stage, error: unknown) => {
    if (stage.state === 'failed') return;
    console.warn(`[darkbeacon] ${stage.name} stage fell back to its still`, error);
    clearTimeout(stage.deadline);
    setState(stage, 'failed');
    try {
      stage.dispose?.();
    } catch {
      // Cleanup must never replace the failure that caused it.
    }
    stage.scene = undefined;
  };

  const failAll = (error: unknown) => {
    if (dead) return;
    dead = true;
    cancelAnimationFrame(raf);
    for (const stage of stages) failStage(stage, error);
    options.onUnavailable(error);
  };

  gpu.onError((error) => failAll(error));
  gpu.gpu.lost.then((info) => failAll(new Error(`device lost: ${info.message}`))).catch(() => undefined);

  const renderStill = (stage: Stage) => {
    const scene = stage.scene;
    if (!scene || dead) return;
    const still = scene.still ?? { time: 6, progress: 0.5 };
    frame(gpu, (f) =>
      scene.render(f, {
        time: still.time,
        dt: 0,
        progress: still.progress,
        pointer: { x: 0, y: 0, influence: 0 },
      }),
    );
  };

  const load = async (stage: Stage) => {
    if (stage.state !== 'idle' || dead) return;
    setState(stage, 'loading');
    try {
      const { create } = await SCENES[stage.name]!();
      if (dead) return;
      const rect = stage.canvas.getBoundingClientRect();
      // Captures render at the page's full device pixel ratio; visitors get the budget.
      const cap = options.capture
        ? devicePixelRatio
        : dprCap(rect.width, rect.height, BUDGET[stage.name as keyof typeof BUDGET] ?? 1_000_000);
      const canvasSurface = surface(gpu, stage.canvas, { dpr: [Math.min(1, cap), cap], alphaMode: 'opaque' });
      const pointer = reducedMotion || options.capture ? parkedPointer : installPointer(stage.el);
      const scene = await create({
        gpu,
        surface: canvasSurface,
        stage: stage.el,
        reducedMotion,
        quality,
      });
      if (dead) {
        scene.dispose();
        return;
      }
      stage.scene = scene;
      stage.pointer = pointer;
      const unsubscribe = canvasSurface.onResize(({ width, height }) => {
        scene.resize?.(width, height);
        if (reducedMotion && stage.state === 'live') requestAnimationFrame(() => renderStill(stage));
      });
      stage.dispose = () => {
        unsubscribe();
        pointer.dispose();
        scene.dispose();
        canvasSurface.dispose();
      };

      // The first frame, then the reveal one compositor tick later, once it is really there.
      armDeadline(stage);
      if (reducedMotion || options.capture) {
        renderStill(stage);
      } else {
        frame(gpu, (f) => scene.render(f, { time: 0, dt: 0, progress: stage.progress, pointer }));
      }
      requestAnimationFrame(() => {
        if (stage.state !== 'loading') return;
        clearTimeout(stage.deadline);
        setState(stage, 'live');
        wake();
      });
    } catch (error) {
      failStage(stage, error);
    }
  };

  const armDeadline = (stage: Stage) => {
    clearTimeout(stage.deadline);
    if (document.hidden) return;
    stage.deadline = setTimeout(() => {
      if (stage.state === 'loading' && !document.hidden) failStage(stage, new Error('no first frame'));
    }, FIRST_FRAME_TIMEOUT_MS);
  };

  const tick = (now: number) => {
    raf = 0;
    if (dead) return;
    const dt = Math.min(MAX_DT, Math.max(0, (now - last) / 1000));
    last = now;
    const active = stages.filter((s) => s.state === 'live' && s.visible && s.scene);
    if (active.length === 0 || document.hidden) return;

    // Hold the frame rate: step quality down when frames keep running long.
    slowFor = dt > SLOW_FRAME ? slowFor + dt : Math.max(0, slowFor - dt * 0.5);
    if (slowFor > SLOW_FOR_SECONDS && quality > 0.5) {
      quality = Math.max(0.5, quality - 0.2);
      slowFor = 0;
      for (const stage of stages) stage.scene?.setQuality?.(quality);
    }

    for (const stage of active) {
      stage.time += dt;
      stage.pointer.update(dt);
      const target = measure(stage.el);
      stage.progress += (target - stage.progress) * (1 - Math.exp(-dt / 0.12));
    }
    try {
      frame(gpu, (f) => {
        for (const stage of active) {
          stage.scene!.render(f, {
            time: stage.time,
            dt,
            progress: stage.progress,
            pointer: stage.pointer,
          });
        }
      });
    } catch (error) {
      failAll(error);
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  const wake = () => {
    if (reducedMotion || options.capture || dead || raf !== 0) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  const nearObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const stage = stages.find((s) => s.el === entry.target);
        if (!stage) continue;
        stage.near = entry.isIntersecting;
        if (stage.near) void load(stage);
      }
    },
    { rootMargin: NEAR_MARGIN },
  );
  const visibleObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const stage = stages.find((s) => s.el === entry.target);
      if (!stage) continue;
      stage.visible = entry.isIntersecting;
      if (stage.visible) {
        stage.progress = measure(stage.el);
      }
    }
    wake();
  });
  for (const stage of stages) {
    if (!options.capture) nearObserver.observe(stage.el);
    visibleObserver.observe(stage.el);
  }

  document.addEventListener('visibilitychange', () => {
    for (const stage of stages) if (stage.state === 'loading') armDeadline(stage);
    if (!document.hidden) wake();
  });

  if (options.capture) {
    // Deterministic captures for the pre-rendered stills, loops and Open Graph image.
    (window as unknown as { __dbk: unknown }).__dbk = {
      stages: stages.map(key),
      async load(name: string) {
        const stage = stages.find((s) => key(s) === name);
        if (!stage) throw new Error(`no stage ${name}`);
        await load(stage);
        return stage.state;
      },
      setQuality(next: number) {
        quality = next;
        for (const stage of stages) stage.scene?.setQuality?.(quality);
      },
      async render(name: string, time: number, progress: number, x = 0, y = 0) {
        const stage = stages.find((s) => key(s) === name);
        if (!stage?.scene) throw new Error(`stage ${name} not loaded`);
        const scene = stage.scene;
        frame(gpu, (f) =>
          scene.render(f, { time, dt: 1 / 30, progress, pointer: { x, y, influence: 0 } }),
        );
        await gpu.settled();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      },
    };
    document.documentElement.dataset.capture = 'ready';
  }
}

/** A stage's name, with its mood where it has one: `transit:fight`. */
const key = (stage: { name: string; el: HTMLElement }) =>
  stage.el.dataset.mood ? `${stage.name}:${stage.el.dataset.mood}` : stage.name;

/** 0 as the element's top enters at the bottom of the viewport, 1 as its bottom leaves the top. */
function measure(el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight || 1;
  return Math.min(1, Math.max(0, (vh - rect.top) / (vh + rect.height)));
}
