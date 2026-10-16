/**
 * The only GPU code in the page's own bundle, and it is small on purpose: it decides whether
 * the scenes run here, and when.
 *
 * `<html data-gpu>` is set by an inline script in the head before first paint: `pending` where
 * `navigator.gpu` exists, `off` where it does not (or with `?gpu=off`). CSS keys the posters off
 * it, so a browser without WebGPU paints the pre-rendered stills from the first frame and one
 * with it never flashes them.
 *
 * With WebGPU, the runtime chunk is fetched only after the load event and an idle period, so the
 * first paint, the largest paint and the main thread during load carry none of it. Without, the
 * hero's pre-rendered loop is attached instead, under the same conditions, and only for people
 * who have not asked for reduced motion or reduced data.
 */

import { importWithRetry } from './retry';

const root = document.documentElement;
const params = new URLSearchParams(location.search);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
const capture = params.has('capture');

const afterLoad = (run: () => void) => {
  const idle = () =>
    'requestIdleCallback' in window ? requestIdleCallback(run, { timeout: 2500 }) : setTimeout(run, 400);
  if (capture) run();
  else if (document.readyState === 'complete') idle();
  else addEventListener('load', idle, { once: true });
};

/** Swap each stage's still for its loop, where it has one. */
const attachLoops = () => {
  // Loops are for large screens only: on a phone the still is the better use of the data.
  if (reducedMotion || saveData || !matchMedia('(min-width: 900px)').matches) return;
  for (const stage of document.querySelectorAll<HTMLElement>('[data-loop]')) {
    const base = stage.dataset.loop;
    if (!base || stage.querySelector('video')) continue;
    const video = document.createElement('video');
    video.className = 'stage-loop';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.autoplay = true;
    video.setAttribute('aria-hidden', 'true');
    video.preload = 'auto';
    for (const [type, ext] of [
      ['video/webm; codecs=vp9', 'webm'],
      ['video/mp4; codecs=avc1.640028', 'mp4'],
    ] as const) {
      const source = document.createElement('source');
      source.src = `${base}.${ext}`;
      source.type = type;
      video.append(source);
    }
    video.addEventListener('playing', () => stage.setAttribute('data-loop-playing', ''), { once: true });
    stage.append(video);
    void video.play().catch(() => undefined);
  }
};

const fallBack = () => {
  root.dataset.gpu = 'off';
  attachLoops();
};

afterLoad(() => {
  if (root.dataset.gpu !== 'pending') {
    attachLoops();
    return;
  }
  // Only this, a browser with no WebGPU or no adapter, or a device lost at start turns the whole
  // page to stills; a scene that fails later falls back on its own stage (runtime.ts).
  importWithRetry(() => import('./runtime'))
    .then(({ start }) =>
      start({
        reducedMotion,
        capture,
        onUnavailable: fallBack,
      }),
    )
    .then(() => {
      if (root.dataset.gpu === 'pending') root.dataset.gpu = 'on';
    })
    .catch(fallBack);
});
