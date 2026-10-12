import { BUCKET_POCHVEN, BUCKET_ZARZAKH, COLOR_BUCKETS, type StarModel } from './model';

/** What part of the map is on screen: `scale` px per light year around the centre `cx, cy` (ly). */
export interface View {
  scale: number;
  cx: number;
  cy: number;
  /** CSS pixels. */
  width: number;
  height: number;
}

export interface RouteLeg {
  from: number;
  to: number;
  kind: 'jump' | 'gate' | 'ansiblex';
}

/** Everything drawn on top of the stars. */
export interface Overlay {
  origin: number | null;
  destination: number | null;
  hover: number | null;
  /** Jump range drawn around `rangeFrom` (the start, or the start of the leg in focus). */
  rangeFrom: number | null;
  rangeLy: number | null;
  /** Systems a jump from `rangeFrom` may land in (1), when the range is shown. */
  reachable: Uint8Array | null;
  route: readonly RouteLeg[] | null;
  /** Leg under the pointer in the legs list. */
  activeLeg: number | null;
  avoided: ReadonlySet<number>;
  /** Known-space systems the chain reaches (wormhole exits). */
  exits: ReadonlySet<number>;
}

/** Theme colours, read from the `--dbk-*` tokens. */
export interface Palette {
  canvas: string;
  gate: string;
  text: string;
  textMuted: string;
  accent: string;
  accentContrast: string;
  special: string;
  danger: string;
  success: string;
  warning: string;
  /** Light themes outline the bright security colours. */
  dark: boolean;
  /** The theme's UI font family. */
  font: string;
}

export function toScreen(view: View, px: number, py: number): [number, number] {
  return [(px - view.cx) * view.scale + view.width / 2, (py - view.cy) * view.scale + view.height / 2];
}

export function toWorld(view: View, sx: number, sy: number): [number, number] {
  return [(sx - view.width / 2) / view.scale + view.cx, (sy - view.height / 2) / view.scale + view.cy];
}

/** Below this scale region names show, above it system names. */
export const REGION_LABELS_BELOW = 16;
export const SYSTEM_LABELS_FROM = 22;

export function dotRadius(scale: number): number {
  return Math.max(1.3, Math.min(4.5, scale * 0.11));
}

/**
 * Paints the whole map: stargates, the range, systems by security colour, the route, markers and
 * labels. Only what is on screen is drawn; one path per colour keeps it to a few draw calls.
 */
export function drawStarMap(
  ctx: CanvasRenderingContext2D,
  model: StarModel,
  view: View,
  overlay: Overlay,
  palette: Palette,
): void {
  const { width, height, scale } = view;
  const half = { x: width / 2, y: height / 2 };
  const sx = (i: number) => (model.px[i]! - view.cx) * scale + half.x;
  const sy = (i: number) => (model.py[i]! - view.cy) * scale + half.y;
  const margin = 40;
  const visible = (x: number, y: number) =>
    x > -margin && y > -margin && x < width + margin && y < height + margin;

  ctx.fillStyle = palette.canvas;
  ctx.fillRect(0, 0, width, height);

  // What stands out: the route's systems once there is a route, else the systems in range.
  const route = overlay.route ?? [];
  let emphasis: Uint8Array | null = null;
  if (route.length > 0) {
    emphasis = new Uint8Array(model.size);
    for (const leg of route) emphasis[leg.from] = emphasis[leg.to] = 1;
  } else if (overlay.reachable) emphasis = overlay.reachable;
  const quiet = route.length > 0 ? 0.5 : 1;

  // Stargates: faint at the universe view, clearer when zoomed in; the few long ones fainter still.
  if (scale >= 3) {
    const base = Math.min(1, 0.25 + (scale - 3) / 30) * quiet * (palette.dark ? 1 : 0.7);
    ctx.strokeStyle = palette.gate;
    ctx.lineWidth = 1;
    const g = model.gates;
    for (const long of [false, true]) {
      ctx.globalAlpha = long ? base * 0.4 : base;
      ctx.beginPath();
      for (let k = 0; k < g.length; k += 2) {
        const a = g[k]!;
        const b = g[k + 1]!;
        const dx = model.px[a]! - model.px[b]!;
        const dy = model.py[a]! - model.py[b]!;
        if (dx * dx + dy * dy > 64 !== long) continue;
        const ax = sx(a);
        const ay = sy(a);
        const bx = sx(b);
        const by = sy(b);
        if (!visible(ax, ay) && !visible(bx, by) && !crosses(ax, ay, bx, by, width, height)) continue;
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Jump range: the sphere seen from above is a disk of the same radius.
  if (overlay.rangeFrom !== null && overlay.rangeLy) {
    const [cx, cy] = [sx(overlay.rangeFrom), sy(overlay.rangeFrom)];
    const r = overlay.rangeLy * scale;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.globalAlpha = palette.dark ? 0.08 : 0.1;
    ctx.fillStyle = palette.accent;
    ctx.fill();
    ctx.globalAlpha = 0.85;
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = palette.accent;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // Systems, one path per colour; with an emphasis, the rest first and dimmed.
  const r = dotRadius(scale);
  for (let pass = 0; pass < (emphasis ? 2 : 1); pass++) {
    for (let b = 0; b < COLOR_BUCKETS.length; b++) {
      ctx.beginPath();
      let any = false;
      for (let i = 0; i < model.size; i++) {
        if (model.bucket[i] !== b) continue;
        if (emphasis && (emphasis[i] === 1) !== (pass === 1)) continue;
        const x = sx(i);
        const y = sy(i);
        if (!visible(x, y)) continue;
        any = true;
        if (r < 2.2) ctx.rect(x - r, y - r, r * 2, r * 2);
        else {
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
      }
      if (!any) continue;
      ctx.globalAlpha = emphasis && pass === 0 ? (route.length > 0 ? 0.45 : 0.28) : 1;
      ctx.fillStyle = b === BUCKET_POCHVEN || b === BUCKET_ZARZAKH ? palette.special : COLOR_BUCKETS[b]!;
      ctx.fill();
      if (!palette.dark && r >= 2.2) {
        ctx.lineWidth = 0.75;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;

  // Avoided systems: a small cross.
  if (overlay.avoided.size > 0) {
    ctx.strokeStyle = palette.danger;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const d = Math.max(4, r + 2);
    for (const i of overlay.avoided) {
      const x = sx(i);
      const y = sy(i);
      if (!visible(x, y)) continue;
      ctx.moveTo(x - d, y - d);
      ctx.lineTo(x + d, y + d);
      ctx.moveTo(x + d, y - d);
      ctx.lineTo(x - d, y + d);
    }
    ctx.stroke();
  }

  // Wormhole chain exits: a diamond.
  if (overlay.exits.size > 0) {
    ctx.strokeStyle = palette.warning;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const d = Math.max(5, r + 3);
    for (const i of overlay.exits) {
      const x = sx(i);
      const y = sy(i);
      if (!visible(x, y)) continue;
      ctx.moveTo(x, y - d);
      ctx.lineTo(x + d, y);
      ctx.lineTo(x, y + d);
      ctx.lineTo(x - d, y);
      ctx.closePath();
    }
    ctx.stroke();
  }

  // The route: bowed arcs for jumps, dashed lines for gates and Ansiblex bridges.
  route.forEach((leg, n) => {
    const ax = sx(leg.from);
    const ay = sy(leg.from);
    const bx = sx(leg.to);
    const by = sy(leg.to);
    const active = overlay.activeLeg === n;
    if (leg.kind === 'jump') {
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const len = Math.hypot(bx - ax, by - ay);
      const bow = Math.min(len * 0.18, 60);
      const nx = len === 0 ? 0 : (-(by - ay) / len) * bow;
      const ny = len === 0 ? 0 : ((bx - ax) / len) * bow;
      for (const [w, color] of [
        [active ? 8 : 7, palette.canvas],
        [active ? 4 : 3, palette.accent],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo(mx + nx, my + ny, bx, by);
        ctx.lineWidth = w;
        ctx.strokeStyle = color;
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineWidth = active ? 3.5 : 2.5;
      ctx.setLineDash(leg.kind === 'gate' ? [5, 4] : [2, 4]);
      ctx.strokeStyle = leg.kind === 'gate' ? palette.text : palette.success;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  // Stops of the route, numbered.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 10px ${palette.font}`;
  route.forEach((leg, n) => {
    if (leg.to === overlay.destination) return;
    const x = sx(leg.to);
    const y = sy(leg.to);
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = leg.kind === 'jump' ? palette.accent : palette.canvas;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = leg.kind === 'jump' ? palette.canvas : palette.text;
    ctx.stroke();
    ctx.fillStyle = leg.kind === 'jump' ? palette.accentContrast : palette.text;
    ctx.fillText(String(n + 1), x, y + 0.5);
  });

  // Start and destination.
  for (const [i, filled] of [
    [overlay.origin, true],
    [overlay.destination, false],
  ] as const) {
    if (i === null) continue;
    const x = sx(i);
    const y = sy(i);
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fillStyle = filled ? palette.accent : palette.canvas;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = palette.accent;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = filled ? palette.accentContrast : palette.accent;
    ctx.fill();
  }

  if (overlay.hover !== null) {
    ctx.beginPath();
    ctx.arc(sx(overlay.hover), sy(overlay.hover), Math.max(7, r + 4), 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = palette.text;
    ctx.stroke();
  }

  drawLabels(ctx, model, view, overlay, palette, sx, sy, visible, r, emphasis);
}

function drawLabels(
  ctx: CanvasRenderingContext2D,
  model: StarModel,
  view: View,
  overlay: Overlay,
  palette: Palette,
  sx: (i: number) => number,
  sy: (i: number) => number,
  visible: (x: number, y: number) => boolean,
  r: number,
  emphasis: Uint8Array | null,
): void {
  const family = palette.font;
  const { scale } = view;
  // Labels claim cells of a coarse grid; a label whose cells are taken is skipped.
  const taken = new Set<number>();
  const CELL_W = 24;
  const CELL_H = 14;
  const claim = (x: number, y: number, w: number, h: number, force = false) => {
    const keys: number[] = [];
    for (let a = Math.floor(x / CELL_W); a <= Math.floor((x + w) / CELL_W); a++)
      for (let b = Math.floor(y / CELL_H); b <= Math.floor((y + h) / CELL_H); b++) {
        const key = (a + 100) * 10_000 + (b + 100);
        if (taken.has(key) && !force) return false;
        keys.push(key);
      }
    for (const key of keys) taken.add(key);
    return true;
  };

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const label = (i: number, weight: number, size: number, color: string, force: boolean) => {
    const x = sx(i);
    const y = sy(i);
    if (!visible(x, y)) return;
    const text = model.names[i]!;
    ctx.font = `${weight} ${size}px ${family}`;
    const w = ctx.measureText(text).width;
    const lx = x + Math.max(r, 6) + 4;
    if (!claim(lx, y - size / 2, w, size, force)) return;
    ctx.globalAlpha = force || !emphasis || emphasis[i] === 1 ? 1 : 0.5;
    ctx.lineWidth = 3;
    ctx.strokeStyle = palette.canvas;
    ctx.strokeText(text, lx, y);
    ctx.fillStyle = color;
    ctx.fillText(text, lx, y);
    ctx.globalAlpha = 1;
  };

  // The route's systems, the start, the destination and the one under the pointer always get a name.
  const important = new Set<number>();
  for (const leg of overlay.route ?? []) {
    important.add(leg.from);
    important.add(leg.to);
  }
  for (const i of [overlay.origin, overlay.destination, overlay.hover]) if (i !== null) important.add(i);
  for (const i of important) label(i, 600, 13, palette.text, true);

  if (scale < REGION_LABELS_BELOW) {
    ctx.textAlign = 'center';
    ctx.globalAlpha =
      scale < REGION_LABELS_BELOW * 0.75 ? 1 : (REGION_LABELS_BELOW - scale) / (REGION_LABELS_BELOW * 0.25);
    ctx.font = `600 11px ${family}`;
    for (const region of model.regions) {
      if (region.scattered) continue;
      const x = (region.px - view.cx) * scale + view.width / 2;
      const y = (region.py - view.cy) * scale + view.height / 2;
      if (!visible(x, y)) continue;
      const text = region.name.toUpperCase();
      const w = ctx.measureText(text).width;
      if (!claim(x - w / 2, y - 6, w, 12)) continue;
      ctx.lineWidth = 3;
      ctx.strokeStyle = palette.canvas;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = palette.textMuted;
      ctx.fillText(text, x, y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  if (scale >= SYSTEM_LABELS_FROM) {
    let drawn = 0;
    for (let i = 0; i < model.size && drawn < 700; i++) {
      if (important.has(i)) continue;
      const x = sx(i);
      const y = sy(i);
      if (x < 0 || y < 0 || x > view.width || y > view.height) continue;
      label(i, 400, 11, palette.textMuted, false);
      drawn += 1;
    }
  }
}

/** Whether a segment with both ends off screen still passes through it (a long stargate). */
function crosses(ax: number, ay: number, bx: number, by: number, width: number, height: number): boolean {
  if (Math.max(ax, bx) < 0 || Math.min(ax, bx) > width || Math.max(ay, by) < 0 || Math.min(ay, by) > height)
    return false;
  return true;
}
