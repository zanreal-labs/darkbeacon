'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { IconButton } from '../ui';
import { drawStarMap, dotRadius, toWorld, type Overlay, type Palette, type View } from './draw';
import { systemAt, type StarModel } from './model';
import styles from './jump.module.css';

export interface StarMapHandle {
  /** Flies to fit these systems (all of known space when empty). */
  fit(systems: readonly number[]): void;
  /** Flies to a system, keeping the zoom when it is close enough already. */
  centre(system: number): void;
}

export interface StarMapProps {
  model: StarModel;
  overlay: Overlay;
  /** Space covered by the controls (CSS px), so fitting keeps clear of them. */
  insets: { left: number; bottom: number };
  onHover(system: number | null, at: { x: number; y: number } | null): void;
  /** A click (or tap) on a system, or on empty space (null). */
  onPick(system: number | null, at: { x: number; y: number }): void;
  ref?: Ref<StarMapHandle>;
}

const MIN_SCALE = 2;
const MAX_SCALE = 400;
/** Pointer distance (CSS px) within which a system counts as under it. */
const HIT_PX = 12;

function readPalette(element: HTMLElement): Palette {
  const css = getComputedStyle(element);
  const v = (name: string, fallback: string) => css.getPropertyValue(`--dbk-${name}`).trim() || fallback;
  const canvas = v('color-canvas', '#0a0c10');
  return {
    canvas,
    gate: v('edge-gate', '#6b7486'),
    text: v('color-text', '#e8eaee'),
    textMuted: v('color-text-muted', '#9aa3b4'),
    accent: v('color-accent', '#38c6d6'),
    accentContrast: v('color-accent-contrast', '#000'),
    special: v('security-special', '#b98cf5'),
    danger: v('color-danger', '#f05252'),
    success: v('color-success', '#3fb950'),
    warning: v('color-warning', '#d29922'),
    dark: isDark(canvas),
    font: v('font-family', 'system-ui, sans-serif'),
  };
}

function isDark(color: string): boolean {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (!hex) return !window.matchMedia?.('(prefers-color-scheme: light)').matches;
  const n = Number.parseInt(hex[1]!, 16);
  const luminance = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return luminance < 128;
}

/**
 * The star map: all of known space on a 2D canvas, panned by dragging, zoomed by the wheel or a
 * pinch. It redraws only when something changed, one frame at a time.
 */
export function StarMap({ model, overlay, insets, onHover, onPick, ref }: StarMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ scale: 6, cx: 0, cy: 0, width: 0, height: 0 });
  const overlayRef = useRef(overlay);
  const paletteRef = useRef<Palette | null>(null);
  const frame = useRef(0);
  const flight = useRef(0);
  const insetsRef = useRef(insets);
  const callbacks = useRef({ onHover, onPick });
  useEffect(() => {
    callbacks.current = { onHover, onPick };
    insetsRef.current = insets;
  });

  const draw = useCallback(() => {
    frame.current = 0;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const started = performance.now();
    paletteRef.current ??= readPalette(canvas);
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStarMap(ctx, model, view.current, overlayRef.current, paletteRef.current);
    canvas.dataset.frameMs = (performance.now() - started).toFixed(2);
  }, [model]);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  const clampScale = (scale: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));

  /** The view that shows these projected bounds inside the area the controls leave free. */
  const fitted = useCallback((minX: number, maxX: number, minY: number, maxY: number, pad = 48): View => {
    const v = view.current;
    const { left, bottom } = insetsRef.current;
    const w = Math.max(80, v.width - left - pad * 2);
    const h = Math.max(80, v.height - bottom - pad * 2);
    const scale = clampScale(Math.min(w / Math.max(maxX - minX, 0.5), h / Math.max(maxY - minY, 0.5), 60));
    // Centre the bounds in the free area, which is offset by the insets.
    const cx = (minX + maxX) / 2 - left / 2 / scale;
    const cy = (minY + maxY) / 2 + bottom / 2 / scale;
    return { ...v, scale, cx, cy };
  }, []);

  const fly = useCallback(
    (target: View) => {
      cancelAnimationFrame(flight.current);
      const from = { ...view.current };
      const started = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - started) / 380);
        const e = 1 - (1 - t) ** 3;
        // Zoom in log space so the motion feels even.
        const scale = Math.exp(Math.log(from.scale) + (Math.log(target.scale) - Math.log(from.scale)) * e);
        view.current = {
          ...view.current,
          scale,
          cx: from.cx + (target.cx - from.cx) * e,
          cy: from.cy + (target.cy - from.cy) * e,
        };
        schedule();
        if (t < 1) flight.current = requestAnimationFrame(step);
      };
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        view.current = { ...view.current, scale: target.scale, cx: target.cx, cy: target.cy };
        schedule();
      } else flight.current = requestAnimationFrame(step);
    },
    [schedule],
  );

  useImperativeHandle(
    ref,
    () => ({
      fit(systems) {
        if (systems.length === 0) {
          const b = model.bounds;
          fly(fitted(b.minX, b.maxX, b.minY, b.maxY, 24));
          return;
        }
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const i of systems) {
          minX = Math.min(minX, model.px[i]!);
          maxX = Math.max(maxX, model.px[i]!);
          minY = Math.min(minY, model.py[i]!);
          maxY = Math.max(maxY, model.py[i]!);
        }
        fly(fitted(minX, maxX, minY, maxY, 72));
      },
      centre(system) {
        const scale = Math.max(view.current.scale, 28);
        const { left, bottom } = insetsRef.current;
        fly({
          ...view.current,
          scale,
          cx: model.px[system]! - left / 2 / scale,
          cy: model.py[system]! + bottom / 2 / scale,
        });
      },
    }),
    [fitted, fly, model],
  );

  useEffect(() => {
    overlayRef.current = overlay;
    schedule();
  }, [overlay, schedule]);

  // Size, pixel ratio and theme.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    let first = true;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      view.current = { ...view.current, width: rect.width, height: rect.height };
      if (first && rect.width > 0) {
        first = false;
        const b = model.bounds;
        view.current = fitted(b.minX, b.maxX, b.minY, b.maxY, 24);
      }
      schedule();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    const retheme = () => {
      paletteRef.current = null;
      schedule();
    };
    const themeObserver = new MutationObserver(retheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'style', 'class'],
    });
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', retheme);
    return () => {
      observer.disconnect();
      themeObserver.disconnect();
      media?.removeEventListener('change', retheme);
      cancelAnimationFrame(frame.current);
      cancelAnimationFrame(flight.current);
      frame.current = 0;
    };
  }, [fitted, model, schedule]);

  // Pointer: drag to pan, pinch or wheel to zoom, click to pick, hover to preview.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = false;
    let downAt: { x: number; y: number } | null = null;
    let pinch: { distance: number; scale: number } | null = null;

    const local = (e: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const hit = (p: { x: number; y: number }) => {
      const [wx, wy] = toWorld(view.current, p.x, p.y);
      const radius = Math.max(HIT_PX, dotRadius(view.current.scale) + 4) / view.current.scale;
      const i = systemAt(model, wx, wy, radius);
      return i < 0 ? null : i;
    };
    const zoomAt = (p: { x: number; y: number }, factor: number) => {
      const v = view.current;
      const scale = clampScale(v.scale * factor);
      const [wx, wy] = toWorld(v, p.x, p.y);
      view.current = {
        ...v,
        scale,
        cx: wx - (p.x - v.width / 2) / scale,
        cy: wy - (p.y - v.height / 2) / scale,
      };
      schedule();
    };

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      cancelAnimationFrame(flight.current);
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 1) {
        moved = false;
        downAt = p;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), scale: view.current.scale };
        moved = true;
      }
    };
    const move = (e: PointerEvent) => {
      const p = local(e);
      const last = pointers.get(e.pointerId);
      if (!last) {
        if (e.pointerType === 'mouse') {
          const i = hit(p);
          callbacks.current.onHover(i, i === null ? null : p);
          canvas.style.cursor = i === null ? 'grab' : 'pointer';
        }
        return;
      }
      pointers.set(e.pointerId, p);
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
        zoomAt(mid, (pinch.scale * (distance / pinch.distance)) / view.current.scale);
        return;
      }
      if (downAt && !moved && Math.hypot(p.x - downAt.x, p.y - downAt.y) < 5) return;
      if (!moved) callbacks.current.onHover(null, null);
      moved = true;
      canvas.style.cursor = 'grabbing';
      const v = view.current;
      view.current = { ...v, cx: v.cx - (p.x - last.x) / v.scale, cy: v.cy - (p.y - last.y) / v.scale };
      schedule();
    };
    const up = (e: PointerEvent) => {
      const p = local(e);
      const was = pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!was || pointers.size > 0) return;
      canvas.style.cursor = 'grab';
      if (!moved) callbacks.current.onPick(hit(p), p);
      downAt = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnimationFrame(flight.current);
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(local(e), Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0018)));
    };
    const context = (e: MouseEvent) => {
      e.preventDefault();
      const p = local(e);
      callbacks.current.onPick(hit(p), p);
    };
    const leave = () => callbacks.current.onHover(null, null);

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('contextmenu', context);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('contextmenu', context);
    };
  }, [model, schedule]);

  const zoomBy = useCallback(
    (factor: number) => {
      const v = view.current;
      const { left, bottom } = insetsRef.current;
      const scale = clampScale(v.scale * factor);
      // Zoom around the middle of the free area.
      const mx = left + (v.width - left) / 2;
      const my = (v.height - bottom) / 2;
      const [wx, wy] = toWorld(v, mx, my);
      fly({ ...v, scale, cx: wx - (mx - v.width / 2) / scale, cy: wy - (my - v.height / 2) / scale });
    },
    [fly],
  );
  const showAll = useCallback(() => {
    const b = model.bounds;
    fly(fitted(b.minX, b.maxX, b.minY, b.maxY, 24));
  }, [fitted, fly, model]);

  return (
    <div ref={wrapRef} className={styles.mapWrap}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        role="img"
        aria-label="Star map of known space. Drag to pan, scroll or pinch to zoom, click a system for its actions."
      />
      <div className={styles.zoom} style={{ bottom: insets.bottom + 16 }}>
        <IconButton label="Zoom in" icon={<Plus />} tooltipSide="left" onClick={() => zoomBy(1.6)} />
        <IconButton label="Zoom out" icon={<Minus />} tooltipSide="left" onClick={() => zoomBy(1 / 1.6)} />
        <IconButton
          label="Show all of known space"
          icon={<Maximize />}
          tooltipSide="left"
          onClick={showAll}
        />
      </div>
    </div>
  );
}
