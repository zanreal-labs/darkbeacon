/**
 * Lightspeed on the "Open app" buttons. On hover (or keyboard focus) the white pill turns into a
 * window onto deep space and the stars in it jump: still points first, then streaks radiating from
 * the centre, short and dim near the vanishing point, long, bright and fast toward the edges, as
 * a perspective starfield does. ~400 ms from rest to full flow, ~250 ms back on leave. A click
 * maxes the streaks, flashes white and navigates, all inside 250 ms.
 *
 * One small 2D canvas per button, clipped to the pill and drawn under the label; it exists only
 * after the first hover and draws only while the effect runs. Touch gets a CSS press instead, and
 * reduced motion a calm glow (both in global.css).
 */

const ACCELERATE = 0.4;
const DECELERATE = 0.25;
/** On leave the dark fill holds while the stars wind down, then turns white (global.css). */
const BURST_MS = 230;
/** The depth a star is born at, and where it has passed the camera. */
const FAR = 1;
const NEAR = 0.06;

interface Star {
  x: number;
  y: number;
  z: number;
}

interface Warp {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  stars: Star[];
  /** 0..1 (3 on a click): how far into the jump. */
  speed: number;
  /** 0..1: how much the starfield shows at all. */
  presence: number;
  engaged: boolean;
  burst: boolean;
  raf: number;
  last: number;
  w: number;
  h: number;
}

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const warps = new WeakMap<HTMLElement, Warp>();

/** A star somewhere in the field, at a random depth or at the far plane. */
function seed(star: Star, w: number, h: number, anywhere: boolean) {
  // Positions at the far plane cover the pill; a star near the axis would sit still on the label.
  let x = 0;
  let y = 0;
  do {
    x = (Math.random() - 0.5) * w * 0.9;
    y = (Math.random() - 0.5) * h * 0.9;
  } while (Math.abs(x) < w * 0.06 && Math.abs(y) < h * 0.12);
  star.x = x * NEAR * 4;
  star.y = y * NEAR * 4;
  star.z = anywhere ? NEAR + Math.random() * (FAR - NEAR) : FAR;
}

function setup(button: HTMLElement): Warp | undefined {
  const existing = warps.get(button);
  if (existing) return existing;
  const canvas = document.createElement('canvas');
  canvas.className = 'warp-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  button.prepend(canvas);
  const rect = button.getBoundingClientRect();
  // Fewer stars on the small nav button, more on the big ones.
  const count = Math.round(Math.min(140, Math.max(48, (rect.width * rect.height) / 50)));
  const stars = Array.from({ length: count }, () => {
    const s = { x: 0, y: 0, z: 1 };
    seed(s, rect.width, rect.height, true);
    return s;
  });
  const warp: Warp = { canvas, ctx, stars, speed: 0, presence: 0, engaged: false, burst: false, raf: 0, last: 0, w: 0, h: 0 };
  warps.set(button, warp);
  return warp;
}

const project = (v: number, z: number) => v / z;

function draw(button: HTMLElement, warp: Warp, now: number) {
  const dt = Math.min(0.05, Math.max(0.001, (now - warp.last) / 1000));
  warp.last = now;

  // Ease toward the target at a fixed rate, so the jump takes the same time at any frame rate:
  // rest to full in ACCELERATE seconds, back in DECELERATE.
  const target = warp.burst ? 3 : warp.engaged ? 1 : 0;
  const rate = target > warp.speed ? (warp.burst ? 1 / 0.12 : 1 / ACCELERATE) : 1 / DECELERATE;
  warp.speed = target > warp.speed ? Math.min(target, warp.speed + dt * rate * Math.max(1, target)) : Math.max(target, warp.speed - dt * rate);
  warp.presence = warp.engaged || warp.burst ? Math.min(1, warp.presence + dt / 0.18) : Math.max(0, warp.presence - dt / DECELERATE);
  // An ease-in on the visible speed: stars sit still, then go.
  const s = warp.speed <= 1 ? warp.speed * warp.speed * (3 - 2 * warp.speed) : warp.speed;

  const { canvas, ctx } = warp;
  const rect = button.getBoundingClientRect();
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = rect.width;
  const h = rect.height;
  if (warp.w !== w || warp.h !== h) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    warp.w = w;
    warp.h = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.globalAlpha = warp.presence;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  const cx = w / 2;
  const cy = h / 2;
  // Depth travelled per second: a slow drift at rest, a rush at full speed.
  const dz = (0.06 + s * 1.5) * dt;
  // The trail is where the star was a moment ago; its length grows with speed.
  const trail = 0.012 + s * 0.16;
  for (const star of warp.stars) {
    star.z -= dz * (0.6 + 0.4 * star.z);
    const x = cx + project(star.x, star.z);
    const y = cy + project(star.y, star.z);
    if (star.z <= NEAR || x < -4 || x > w + 4 || y < -4 || y > h + 4) {
      seed(star, w, h, false);
      continue;
    }
    const zt = Math.min(FAR, star.z + trail);
    const tx = cx + project(star.x, zt);
    const ty = cy + project(star.y, zt);
    // Near the camera a star is brighter, wider and longer; far away it is a faint point.
    const near = 1 - (star.z - NEAR) / (FAR - NEAR);
    const alpha = Math.min(1, 0.2 + near * 1.3);
    const width = 0.5 + near * 1.1;
    const r = Math.round(190 + 65 * near);
    const g = Math.round(220 + 35 * near);
    // Two strokes: a dim tail and a bright head, so a streak tapers into its own motion.
    const mx = (tx + x) / 2;
    const my = (ty + y) / 2;
    ctx.lineWidth = width * 0.8;
    ctx.strokeStyle = `rgba(${r}, ${g}, 255, ${alpha * 0.35})`;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(mx + 0.01, my);
    ctx.stroke();
    ctx.lineWidth = width;
    ctx.strokeStyle = `rgba(${r}, ${g}, 255, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(x + 0.01, y);
    ctx.stroke();
  }

  // The tunnel's glow at the vanishing point, kept low so the label stays the brightest thing.
  ctx.globalCompositeOperation = 'source-over';
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.55);
  glow.addColorStop(0, `rgba(120, 200, 255, ${0.1 + 0.12 * Math.min(1, s)})`);
  glow.addColorStop(1, 'rgba(120, 200, 255, 0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  // Keep the label clear: the streaks fade out across an ellipse the size of the label, so they
  // rush past around it and never across it.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = 1;
  // Sized to the label itself, so the rest of the pill keeps the full tunnel.
  const label = button.querySelector('.warp-label')?.getBoundingClientRect();
  const rx = Math.min(w * 0.45, (label?.width ?? w * 0.5) / 2 + 10);
  const ry = h * 0.4;
  // Centred on the label, which sits left of the pill's centre to make room for the chevron.
  const lx = label ? label.left - rect.left + label.width / 2 : cx;
  ctx.save();
  ctx.translate(lx, cy);
  ctx.scale(1, ry / rx);
  const lens = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  lens.addColorStop(0, 'rgba(0, 0, 0, 0.97)');
  lens.addColorStop(0.7, 'rgba(0, 0, 0, 0.9)');
  lens.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = lens;
  ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';

  if (!warp.engaged && !warp.burst && warp.presence <= 0 && warp.speed <= 0) {
    warp.raf = 0;
    ctx.clearRect(0, 0, w, h);
    return;
  }
  warp.raf = requestAnimationFrame((t) => draw(button, warp, t));
}

function run(button: HTMLElement, warp: Warp) {
  if (warp.raf) return;
  warp.last = performance.now();
  warp.raf = requestAnimationFrame((t) => draw(button, warp, t));
}

function engage(button: HTMLElement) {
  if (reduced.matches) return;
  const warp = setup(button);
  if (!warp) return;
  warp.engaged = true;
  button.setAttribute('data-warping', '');
  run(button, warp);
}

function release(button: HTMLElement) {
  const warp = warps.get(button);
  if (!warp || warp.burst) return;
  warp.engaged = false;
  button.removeAttribute('data-warping');
}

for (const button of document.querySelectorAll<HTMLAnchorElement>('[data-warp]')) {
  button.addEventListener('pointerenter', (e) => e.pointerType !== 'touch' && engage(button));
  button.addEventListener('pointerleave', () => release(button));
  button.addEventListener('focus', () => button.matches(':focus-visible') && engage(button));
  button.addEventListener('blur', () => release(button));
  button.addEventListener('click', (e) => {
    if (reduced.matches || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!button.href || button.target === '_blank') return;
    const warp = setup(button);
    if (!warp) return;
    e.preventDefault();
    warp.engaged = true;
    warp.burst = true;
    button.setAttribute('data-warping', '');
    button.setAttribute('data-burst', '');
    run(button, warp);
    window.setTimeout(() => {
      window.location.href = button.href;
    }, BURST_MS);
  });
}

// Back through the history cache: settle any button left mid-jump.
addEventListener('pageshow', () => {
  for (const button of document.querySelectorAll<HTMLElement>('[data-burst]')) {
    button.removeAttribute('data-burst');
    const warp = warps.get(button);
    if (warp) warp.burst = false;
    release(button);
  }
});
