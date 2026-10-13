'use client';

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../../ui';
import {
  clampBox,
  minSize,
  moveBox,
  resizeBox,
  snappedUnder,
  type Area,
  type Box,
  type Corner,
} from './layout';
import type { WidgetsController } from './useWidgetsLayout';
import styles from './window.module.css';

/** What a widget's title bar says about it, for the phone dock. */
export interface WidgetBadge {
  count?: number;
  alert?: boolean;
}

export interface WidgetHost {
  /** Floating windows on wide screens; one sheet at a time over a dock on phones (Wanderer's). */
  mode: 'float' | 'phone';
  area: Area;
  boxes: Readonly<Record<string, Box>>;
  /** Windows in the column against the right edge; the others float where they were left. */
  docked: ReadonlySet<string>;
  order: readonly string[];
  controller: WidgetsController;
  /** The widget open in the phone sheet. */
  open: string | null;
  setOpen(id: string | null): void;
  report(id: string, badge: WidgetBadge): void;
  /** How tall a window's content wants it to be (title bar included). */
  reportHeight(id: string, height: number): void;
  /** Changes with the selected system: every window scrolls back to its top. */
  resetKey: unknown;
}

export const WidgetHostContext = createContext<WidgetHost | null>(null);

const CORNERS: ReadonlyArray<{ corner: Corner; name: string }> = [
  { corner: { x: -1, y: -1 }, name: 'nw' },
  { corner: { x: 1, y: -1 }, name: 'ne' },
  { corner: { x: -1, y: 1 }, name: 'sw' },
  { corner: { x: 1, y: 1 }, name: 'se' },
];

/** Things in a title bar that are pressed, not dragged. */
const INTERACTIVE = 'button, a, input, select, textarea, label, [role="menuitem"], [data-no-drag]';

interface Props {
  id: string;
  title: string;
  /** After the title (signatures, pilots); nothing when undefined. */
  count?: number;
  /** A few words after the count ("3 unscanned", "Reinforced 04:12:09"). */
  summary?: ReactNode;
  /** Draws the summary in the warning colour: something there needs a look. */
  alert?: boolean;
  /** Buttons on the right of the title bar. */
  actions?: ReactNode;
  /** The title's own content when it says more than a word (System info: the system). */
  heading?: ReactNode;
  children: ReactNode;
}

/** The window's height its content asks for: title bar, content, the body's padding, the border. */
function measure(section: HTMLElement, header: HTMLElement, content: HTMLElement): number {
  const body = content.parentElement!;
  const style = getComputedStyle(body);
  const pad = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const frame = section.offsetHeight - section.clientHeight;
  return Math.ceil(header.offsetHeight + content.offsetHeight + pad + frame);
}

/**
 * One widget: a window over the map with a 26 px title bar (title, count, a few words, its buttons)
 * and its content below, as tall as the content up to its cap, then scrolling. In the column it
 * stays docked; dragged by the title bar it floats where it is left. It is resized from its
 * corners, brought to the front when touched, and moved or resized with the arrow keys (Shift)
 * while it has the focus. On phones the same content opens in the bottom sheet.
 */
export function WidgetWindow({ id, title, count, summary, alert, actions, heading, children }: Props) {
  const host = useContext(WidgetHostContext);
  const hintId = useId();
  const [live, setLive] = useState<Box | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const report = host?.report;
  useEffect(() => {
    report?.(id, { count, alert });
  }, [report, id, count, alert]);

  // The content's height, before the first paint and whenever it changes.
  const floating = host?.mode === 'float';
  const reportHeight = host?.reportHeight;
  useLayoutEffect(() => {
    const section = sectionRef.current;
    const header = headerRef.current;
    const content = contentRef.current;
    if (!floating || !reportHeight || !section || !header || !content) return;
    const update = () => reportHeight(id, measure(section, header, content));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(content);
    observer.observe(header);
    return () => observer.disconnect();
  }, [floating, reportHeight, id]);

  // Another system: back to the top of the list.
  const resetKey = host?.resetKey;
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [resetKey]);

  const titleBar = (extra?: ReactNode) => (
    <>
      <div className={styles.title}>
        {heading ?? <h2 className={styles.titleText}>{title}</h2>}
        {count !== undefined && (
          <span className={styles.count} data-zero={count === 0 || undefined}>
            {count}
          </span>
        )}
        {summary ? (
          <span className={styles.summary} data-alert={alert || undefined}>
            {summary}
          </span>
        ) : null}
      </div>
      {(actions || extra) && (
        <div className={styles.actions} data-no-drag>
          {actions}
          {extra}
        </div>
      )}
    </>
  );

  const body = (
    <div ref={bodyRef} className={styles.body}>
      <div ref={contentRef} className={styles.content} data-widget-content>
        {children}
      </div>
    </div>
  );

  // Outside a host (tests of one widget): a plain region.
  if (!host)
    return (
      <section className={styles.plain} aria-label={title} data-widget={id}>
        <header className={styles.titleBar}>{titleBar()}</header>
        {body}
      </section>
    );

  if (host.mode === 'phone') {
    if (host.open !== id) return null;
    return (
      <section className={styles.sheet} aria-label={title} data-widget={id}>
        <header className={styles.titleBar}>
          {titleBar(
            <IconButton
              size="sm"
              label={`Close ${title}`}
              tooltip={false}
              icon={<X />}
              onClick={() => host.setOpen(null)}
            />,
          )}
        </header>
        {body}
      </section>
    );
  }

  const box = live ?? host.boxes[id];
  if (!box) return null;
  const others = Object.entries(host.boxes)
    .filter(([other]) => other !== id)
    .map(([, b]) => b);
  const { controller, area } = host;
  const docked = host.docked.has(id);
  const z = host.order.indexOf(id) + 1;
  const least = minSize(id);
  /** The other floating windows: one dropped right under one of them stays under it. */
  const floatingOthers = Object.fromEntries(
    Object.entries(host.boxes).filter(([other]) => other !== id && !host.docked.has(other)),
  );
  const under = (b: Box) => snappedUnder(id, b, floatingOthers, controller.layout);
  /**
   * A resize ends: the window keeps that height by hand (its content scrolls); a docked one stays
   * in the column, a floating one keeps its box.
   */
  const resized = (next: Box) =>
    docked
      ? controller.resizeDocked(id, next, area)
      : controller.place(id, next, area, { resized: true, below: under(next) });

  /** Follows the pointer from a title bar or a corner, and keeps the result when let go. */
  const follow = (e: ReactPointerEvent, next: (dx: number, dy: number) => Box, done: (b: Box) => void) => {
    e.preventDefault();
    controller.raise(id);
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture?.(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    let last: Box | null = null;
    const move = (ev: PointerEvent) => {
      last = next(ev.clientX - startX, ev.clientY - startY);
      setLive(last);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      if (last) done(last);
      setLive(null);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const startDrag = (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(INTERACTIVE)) return;
    const start = box;
    follow(
      e,
      (dx, dy) => moveBox(start, dx, dy, area, others, least),
      (moved) => controller.place(id, moved, area, { below: under(moved) }),
    );
  };

  const startResize = (corner: Corner) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const start = box;
    follow(e, (dx, dy) => resizeBox(start, corner, dx, dy, area, others, least), resized);
  };

  // The window itself focused: arrows move it, Shift and the arrows resize it (10 px a press, no
  // snapping, or a window by an edge could never leave it).
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const step = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[e.key];
    if (!step) return;
    e.preventDefault();
    const [dx, dy] = step as [number, number];
    if (e.shiftKey) resized(clampBox({ ...box, w: box.w + dx, h: box.h + dy }, area, least));
    else {
      const moved = clampBox({ ...box, x: box.x + dx, y: box.y + dy }, area, least);
      controller.place(id, moved, area, { below: under(moved) });
    }
  };

  return (
    <section
      ref={sectionRef}
      className={styles.window}
      aria-label={title}
      aria-describedby={hintId}
      data-widget={id}
      data-docked={docked || undefined}
      data-moving={live ? true : undefined}
      tabIndex={0}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h, zIndex: z }}
      onPointerDownCapture={() => controller.raise(id)}
      onFocus={() => controller.raise(id)}
      onKeyDown={onKeyDown}
    >
      <header ref={headerRef} className={styles.titleBar} onPointerDown={startDrag}>
        {titleBar()}
      </header>
      {body}
      <span id={hintId} className="sr-only">
        Arrow keys move the window, Shift and the arrow keys resize it. Double-click a corner to fit it to its
        content again.
      </span>
      {CORNERS.map(({ corner, name }) => (
        <span
          key={name}
          className={styles.corner}
          data-corner={name}
          aria-hidden
          onPointerDown={startResize(corner)}
          onDoubleClick={() => controller.fit(id)}
        />
      ))}
    </section>
  );
}
