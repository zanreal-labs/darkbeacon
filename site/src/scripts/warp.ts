/**
 * The "Open app" buttons go to lightspeed on hover: stars stretch into streaks rushing out from
 * the centre of the button, past its edges, as the label blooms and nudges forward. Leaving
 * decelerates and settles; a click fires a short full burst before navigating (under 250 ms).
 *
 * Plain 2D canvas, written for this site: one small canvas per button, created on first hover and
 * drawn only while the effect is running, so an idle page pays nothing. Keyboard focus triggers it
 * like hover. Touch gets the CSS press effect instead, and reduced motion a calm glow (CSS).
 */

const STARS = 80;
const SPILL_X = 28;
const SPILL_Y = 16;
const BURST_MS = 220;

interface Star {
  a: number;
  r: number;
  z: number;
}

interface Warp {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  stars: Star[];
  speed: number;
  target: number;
  raf: number;
  last: number;
}

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const warps = new WeakMap<HTMLElement, Warp>();

const spawn = (s: Star, fresh = false) => {
  s.a = Math.random() * Math.PI * 2;
  s.r = fresh ? Math.random() : Math.random() * 0.12;
  s.z = 0.4 + Math.random() * 0.9;
};

function setup(button: HTMLElement): Warp | undefined {
  const existing = warps.get(button);
  if (existing) return existing;
  const canvas = document.createElement('canvas');
  canvas.className = 'warp-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  button.prepend(canvas);
  const stars = Array.from({ length: STARS }, () => {
    const s = { a: 0, r: 0, z: 0 };
    spawn(s, true);
    return s;
  });
  const warp: Warp = { canvas, ctx, stars, speed: 0, target: 0, raf: 0, last: 0 };
  warps.set(button, warp);
  return warp;
}

function frame(button: HTMLElement, warp: Warp, now: number) {
  const dt = Math.min(0.05, (now - warp.last) / 1000 || 0.016);
  warp.last = now;
  // Accelerate hard, decelerate gently: the jump is sudden, the arrival is not.
  const rate = warp.target > warp.speed ? 5 : 2.6;
  warp.speed += (warp.target - warp.speed) * Math.min(1, dt * rate);

  const { canvas, ctx } = warp;
  const rect = button.getBoundingClientRect();
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = rect.width + SPILL_X * 2;
  const h = rect.height + SPILL_Y * 2;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const reach = Math.hypot(w / 2, h / 2);
  const speed = warp.speed;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const s of warp.stars) {
    s.r += dt * (0.05 + speed * 1.5) * (0.15 + s.r) * s.z;
    if (s.r > 1.1) spawn(s);
    const head = s.r * reach;
    const tail = Math.max(0, head - (2 + speed * speed * 26 * s.z) * (0.3 + s.r));
    const dx = Math.cos(s.a);
    const dy = Math.sin(s.a) * 0.62;
    const alpha = Math.min(1, s.r * 2.2) * (0.25 + 0.75 * Math.min(1, speed));
    ctx.strokeStyle = s.z > 0.95 ? `rgba(225, 250, 255, ${alpha})` : `rgba(95, 224, 238, ${alpha * 0.9})`;
    ctx.lineWidth = 0.6 + s.z * 0.9;
    ctx.beginPath();
    ctx.moveTo(cx + dx * tail, cy + dy * tail);
    ctx.lineTo(cx + dx * head, cy + dy * head);
    ctx.stroke();
  }
  // The core flare at the vanishing point, brighter with speed.
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, rect.height * 0.9);
  glow.addColorStop(0, `rgba(200, 248, 255, ${0.25 * Math.min(1.5, speed)})`);
  glow.addColorStop(1, 'rgba(95, 224, 238, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Fade the streaks out past the pill, so they spill a little and never end in a box.
  ctx.globalCompositeOperation = 'destination-in';
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, h / w);
  const fade = ctx.createRadialGradient(0, 0, 0, 0, 0, w / 2);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(rect.width / w, 'rgba(0,0,0,0.85)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(-w / 2, -w / 2, w, w);
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';

  button.style.setProperty('--warp', speed.toFixed(3));
  if (warp.target === 0 && speed < 0.01) {
    warp.raf = 0;
    button.removeAttribute('data-warping');
    ctx.clearRect(0, 0, w, h);
    return;
  }
  warp.raf = requestAnimationFrame((t) => frame(button, warp, t));
}

function engage(button: HTMLElement, target = 1) {
  if (reduced.matches) return;
  const warp = setup(button);
  if (!warp) return;
  warp.target = target;
  button.setAttribute('data-warping', '');
  if (!warp.raf) {
    warp.last = performance.now();
    warp.raf = requestAnimationFrame((t) => frame(button, warp, t));
  }
}

function release(button: HTMLElement) {
  const warp = warps.get(button);
  if (warp) warp.target = 0;
}

for (const button of document.querySelectorAll<HTMLAnchorElement>('[data-warp]')) {
  button.addEventListener('pointerenter', (e) => e.pointerType !== 'touch' && engage(button));
  button.addEventListener('pointerleave', () => release(button));
  button.addEventListener('focus', () => button.matches(':focus-visible') && engage(button));
  button.addEventListener('blur', () => release(button));
  button.addEventListener('click', (e) => {
    if (reduced.matches || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!button.href || button.target === '_blank') return;
    e.preventDefault();
    engage(button, 4);
    button.setAttribute('data-burst', '');
    window.setTimeout(() => {
      window.location.href = button.href;
    }, BURST_MS);
  });
}

// Coming back through the history cache: settle any button left mid-burst.
addEventListener('pageshow', () => {
  for (const button of document.querySelectorAll<HTMLElement>('[data-burst]')) {
    button.removeAttribute('data-burst');
    release(button);
  }
});
