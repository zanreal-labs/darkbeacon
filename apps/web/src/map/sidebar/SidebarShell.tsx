'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { readStored, usePhone, WIDTH_KEY, writeStored } from './storage';
import styles from './sidebar.module.css';

export const SIDEBAR_WIDTH = { default: 380, min: 320, max: 640 };

const isWidth = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampWidth = (w: number) =>
  Math.round(
    Math.min(
      Math.max(w, SIDEBAR_WIDTH.min),
      Math.min(SIDEBAR_WIDTH.max, typeof window === 'undefined' ? Infinity : window.innerWidth - 240),
    ),
  );

/** The sidebar's remembered width, with a setter that keeps it in bounds and stores it. */
export function useSidebarWidth() {
  const [width, setWidthState] = useState(() =>
    clampWidth(
      (typeof window === 'undefined' ? null : readStored(WIDTH_KEY, isWidth)) ?? SIDEBAR_WIDTH.default,
    ),
  );
  const setWidth = useCallback((w: number, persist = true) => {
    const next = clampWidth(w);
    setWidthState(next);
    if (persist) writeStored(WIDTH_KEY, next);
  }, []);
  return [width, setWidth] as const;
}

/**
 * Phone sheet stops: just the header (`peek`, its measured height), half the map, all of it below
 * the map's top bar.
 */
export type SheetStop = 'peek' | 'half' | 'full';
export function sheetHeight(stop: SheetStop, room: number, peek: number): number {
  if (stop === 'peek') return Math.min(peek, room);
  if (stop === 'half') return Math.max(peek, Math.round(room * 0.5));
  return Math.max(peek, room - 56);
}
const NEXT_STOP: Record<SheetStop, SheetStop> = { peek: 'half', half: 'full', full: 'peek' };

interface Props {
  /** What the sidebar is about, for screen readers ("System", "Connection"). */
  label: string;
  /** Shown, or hidden with the top bar's toggle while the selection stays. */
  open: boolean;
  /** A new value (another selection) puts a phone sheet back at its peek stop. */
  resetKey: string | number;
  /** The header, always in view; it gets the phone sheet's handle to place above its first line. */
  header(handle: ReactNode): ReactNode;
  /** One quiet line under the header. */
  note?: ReactNode;
  /** Pixels of the canvas the sidebar covers: its width on wide screens, the sheet on phones. */
  onCover(cover: { right: number; bottom: number }): void;
  children: ReactNode;
}

/**
 * The map's one sidebar shell: docked to the right on wide screens (resizable from its left edge,
 * width remembered), a bottom sheet with peek, half and full stops on phones. The system sidebar
 * and the connection sidebar put their header and sections in it.
 */
export function SidebarShell({ label, open, resetKey, header, note, onCover, children }: Props) {
  const phone = usePhone();
  const [width, setWidth] = useSidebarWidth();
  const [stop, setStop] = useState<SheetStop>('peek');
  const [drag, setDrag] = useState<number | null>(null);
  const [box, setBox] = useState({ room: 0, peek: 120 });
  const heightAt = (at: SheetStop) => sheetHeight(at, box.room, box.peek);
  const rootRef = useRef<HTMLElement>(null);

  // A new selection on a phone starts at the peek stop.
  const [seen, setSeen] = useState(resetKey);
  if (seen !== resetKey) {
    setSeen(resetKey);
    if (stop !== 'peek') setStop('peek');
  }

  // The room the sheet has (the map's height) and its header's height, for the stops.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const parent = root?.parentElement;
    const identity = root?.querySelector<HTMLElement>('[data-identity]');
    if (!parent || !identity) return;
    const measure = () => {
      const next = { room: parent.clientHeight, peek: identity.offsetHeight + 1 };
      setBox((b) => (b.room === next.room && b.peek === next.peek ? b : next));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(parent);
    observer?.observe(identity);
    return () => observer?.disconnect();
  }, [phone]);

  const settled = heightAt(stop);
  const sheet = drag ?? settled;
  useEffect(() => {
    if (!open) onCover({ right: 0, bottom: 0 });
    else if (phone) onCover({ right: 0, bottom: settled });
    else onCover({ right: width, bottom: 0 });
  }, [open, phone, width, settled, onCover]);

  // Resizing from the left edge.
  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture?.(e.pointerId);
    let last = startWidth;
    const move = (ev: PointerEvent) => {
      last = startWidth + (startX - ev.clientX);
      setWidth(last, false);
    };
    const up = () => {
      setWidth(last);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  const resizeKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowLeft') setWidth(width + step);
    else if (e.key === 'ArrowRight') setWidth(width - step);
    else return;
    e.preventDefault();
  };

  // The sheet's handle: drag to any height, let go at the nearest stop; a tap goes to the next.
  const startSheetDrag = (e: ReactPointerEvent) => {
    const startY = e.clientY;
    const startHeight = heightAt(stop);
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture?.(e.pointerId);
    let moved = false;
    let height = startHeight;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientY - startY) > 4) moved = true;
      if (!moved) return;
      height = Math.min(Math.max(startHeight + (startY - ev.clientY), 96), heightAt('full'));
      setDrag(height);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setDrag(null);
      if (!moved) return setStop((s) => NEXT_STOP[s]);
      const stops: SheetStop[] = ['peek', 'half', 'full'];
      setStop(
        stops.reduce((best, s) =>
          Math.abs(heightAt(s) - height) < Math.abs(heightAt(best) - height) ? s : best,
        ),
      );
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const handle = phone ? (
    <button
      type="button"
      className={styles.handle}
      aria-label={
        stop === 'full'
          ? 'Collapse the panel'
          : stop === 'half'
            ? 'Expand the panel fully'
            : 'Expand the panel'
      }
      onPointerDown={startSheetDrag}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setStop((s) => NEXT_STOP[s]);
        }
      }}
    >
      <span aria-hidden />
    </button>
  ) : undefined;

  return (
    <aside
      ref={rootRef}
      className={styles.sidebar}
      aria-label={label}
      hidden={!open}
      data-phone={phone || undefined}
      data-stop={phone ? stop : undefined}
      data-dragging={drag !== null || undefined}
      style={phone ? { height: sheet } : { width }}
    >
      {!phone && (
        <div
          className={styles.resize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the panel"
          aria-valuenow={width}
          aria-valuemin={SIDEBAR_WIDTH.min}
          aria-valuemax={SIDEBAR_WIDTH.max}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={resizeKey}
          onDoubleClick={() => setWidth(SIDEBAR_WIDTH.default)}
        />
      )}
      {header(handle)}
      {note}
      <div className={styles.scroll}>{children}</div>
    </aside>
  );
}
