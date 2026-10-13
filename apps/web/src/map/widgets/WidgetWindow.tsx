'use client';

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../../ui';
import { moveBox, resizeBox, type Area, type Box, type Corner } from './layout';
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
  order: readonly string[];
  controller: WidgetsController;
  /** The widget open in the phone sheet. */
  open: string | null;
  setOpen(id: string | null): void;
  report(id: string, badge: WidgetBadge): void;
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

/**
 * One widget: a window over the map with a 28 px title bar (title, count, a few words, its buttons)
 * and its content scrolling below. On wide screens it is dragged by the title bar, resized from its
 * corners, brought to the front when touched, and moved or resized with the arrow keys (Shift)
 * while it has the focus. On phones the same content opens in the bottom sheet.
 */
export function WidgetWindow({ id, title, count, summary, alert, actions, heading, children }: Props) {
  const host = useContext(WidgetHostContext);
  const hintId = useId();
  const [live, setLive] = useState<Box | null>(null);

  const report = host?.report;
  useEffect(() => {
    report?.(id, { count, alert });
  }, [report, id, count, alert]);

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

  // Outside a host (tests of one widget): a plain region.
  if (!host)
    return (
      <section className={styles.plain} aria-label={title} data-widget={id}>
        <header className={styles.titleBar}>{titleBar()}</header>
        <div className={styles.body}>{children}</div>
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
        <div className={styles.body}>{children}</div>
      </section>
    );
  }

  const box = live ?? host.boxes[id];
  if (!box) return null;
  const others = Object.entries(host.boxes)
    .filter(([other]) => other !== id)
    .map(([, b]) => b);
  const { controller, area } = host;
  const z = host.order.indexOf(id) + 1;

  /** Follows the pointer from a title bar or a corner, and keeps the result when let go. */
  const follow = (e: ReactPointerEvent, next: (dx: number, dy: number) => Box) => {
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
      if (last) controller.place(id, last, area);
      setLive(null);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const startDrag = (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(INTERACTIVE)) return;
    const start = box;
    follow(e, (dx, dy) => moveBox(start, dx, dy, area, others));
  };

  const startResize = (corner: Corner) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const start = box;
    follow(e, (dx, dy) => resizeBox(start, corner, dx, dy, area, others));
  };

  // The window itself focused: arrows move it, Shift and the arrows resize it (10 px a press).
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const step = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[e.key];
    if (!step) return;
    e.preventDefault();
    const [dx, dy] = step as [number, number];
    controller.place(
      id,
      e.shiftKey ? resizeBox(box, { x: 1, y: 1 }, dx, dy, area, []) : moveBox(box, dx, dy, area, []),
      area,
    );
  };

  return (
    <section
      className={styles.window}
      aria-label={title}
      aria-describedby={hintId}
      data-widget={id}
      data-moving={live ? true : undefined}
      tabIndex={0}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h, zIndex: z }}
      onPointerDownCapture={() => controller.raise(id)}
      onFocus={() => controller.raise(id)}
      onKeyDown={onKeyDown}
    >
      <header className={styles.titleBar} onPointerDown={startDrag}>
        {titleBar()}
      </header>
      <div className={styles.body}>{children}</div>
      <span id={hintId} className="sr-only">
        Arrow keys move the window, Shift and the arrow keys resize it.
      </span>
      {CORNERS.map(({ corner, name }) => (
        <span
          key={name}
          className={styles.corner}
          data-corner={name}
          aria-hidden
          onPointerDown={startResize(corner)}
        />
      ))}
    </section>
  );
}

/** The short line a widget shows while no system is selected (as Wanderer's widgets do). */
export function NoSystem() {
  return <p className={styles.none}>No system selected</p>;
}
