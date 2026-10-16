import type { Frame, Gpu, Surface } from 'vgpu';

/** What every scene is told each frame. */
export interface SceneTick {
  /** Seconds of animated time for this stage: it only runs while the stage is on screen, so an
   *  entrance plays the first time a visitor actually sees it. */
  readonly time: number;
  /** Seconds since the previous rendered frame of this stage, clamped. */
  readonly dt: number;
  /** How far the stage has travelled through the viewport: 0 as its top enters at the bottom,
   *  0.5 when it is centred, 1 as its bottom leaves at the top. Smoothed. */
  readonly progress: number;
  /** Pointer over the stage's section, -1..1 from its centre, smoothed; and how engaged it is. */
  readonly pointer: { readonly x: number; readonly y: number; readonly influence: number };
}

export interface SceneContext {
  readonly gpu: Gpu;
  readonly surface: Surface;
  readonly stage: HTMLElement;
  /** True for prefers-reduced-motion: the scene renders one settled still and never loops. */
  readonly reducedMotion: boolean;
  /** 0.5..1, lowered by the runtime when the device cannot hold its frame rate. */
  readonly quality: number;
}

export interface Scene {
  /** Encodes this scene's passes into the shared frame. */
  render(frame: Frame, tick: SceneTick): void;
  /** The surface changed size; rebuild anything sized from it. Called outside any frame. */
  resize?(width: number, height: number): void;
  /** The runtime lowered (or raised) quality; cheaper settings from the next frame. */
  setQuality?(quality: number): void;
  /** Where a reduced-motion still is posed: the settled, representative moment. */
  readonly still?: { readonly time: number; readonly progress: number };
  dispose(): void;
}

export type SceneBuilder = (context: SceneContext) => Scene | Promise<Scene>;
