'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import styles from './ContextMenu.module.css';

/** A colour mark before the label: a dot (statuses), a square (labels) or a line (connection states). */
export interface MenuSwatch {
  /** Any CSS colour, usually `var(--dbk-...)`; none draws an empty ring. */
  color?: string;
  shape?: 'dot' | 'square' | 'line';
  dashed?: boolean;
}

export type MenuItem =
  | {
      kind: 'action';
      label: string;
      onSelect(): void;
      icon?: ReactNode;
      danger?: boolean;
      shortcut?: string;
    }
  | {
      /** On or off. Inside a submenu it keeps the menu open, so several can be set in a row. */
      kind: 'check';
      label: string;
      checked: boolean;
      onSelect(): void;
      icon?: ReactNode;
      swatch?: MenuSwatch;
      title?: string;
    }
  | {
      /** One of several; selecting it closes the menu. */
      kind: 'radio';
      label: string;
      checked: boolean;
      onSelect(): void;
      swatch?: MenuSwatch;
      hint?: string;
    }
  | {
      kind: 'submenu';
      label: string;
      items: MenuItem[];
      icon?: ReactNode;
      /** The current value, muted before the chevron. */
      hint?: string;
      hintSwatch?: MenuSwatch;
    }
  | {
      /** A row that turns into a small text field; Enter saves, Escape goes back. */
      kind: 'input';
      label: string;
      value: string;
      onSubmit(value: string): void;
      icon?: ReactNode;
      placeholder?: string;
      maxLength?: number;
      hint?: string;
    }
  | { kind: 'label'; label: string }
  | { kind: 'separator' }
  | { kind: 'custom'; key: string; render(close: () => void): ReactNode };

export interface ContextMenuProps {
  /** Shown small and muted above the items (the system or connection). */
  title?: string;
  /** A second quiet line under the title (where a merged connection comes from). */
  note?: string;
  x: number;
  y: number;
  items: MenuItem[];
  onClose(): void;
}

/** Hover delays: opening a submenu, and switching away from an open one (room for a diagonal move). */
export const OPEN_DELAY_MS = 120;
export const SWITCH_DELAY_MS = 280;
const MARGIN = 8;
/** Panel padding plus border: a submenu's first row lines up with its trigger. */
const INSET = 5;
const GAP = 2;

interface Size {
  width: number;
  height: number;
}
interface Anchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export interface Placement {
  left: number;
  top: number;
  /** Which way the menu opened: right/down by default, flipped when the viewport ends. */
  side: 'right' | 'left';
  flippedUp: boolean;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

/** A menu at the pointer: below and right of it, flipped left or up where the viewport ends. */
export function placeAtPoint(point: { x: number; y: number }, size: Size, viewport: Size): Placement {
  const right = point.x + size.width <= viewport.width - MARGIN;
  const down = point.y + size.height <= viewport.height - MARGIN;
  return {
    left: clamp(right ? point.x : point.x - size.width, MARGIN, viewport.width - MARGIN - size.width),
    top: clamp(down ? point.y : point.y - size.height, MARGIN, viewport.height - MARGIN - size.height),
    side: right ? 'right' : 'left',
    flippedUp: !down,
  };
}

/** A submenu beside its trigger row: to the right, else to the left; bottom-aligned when it runs off. */
export function placeBeside(anchor: Anchor, size: Size, viewport: Size): Placement {
  const right = anchor.right + GAP + size.width <= viewport.width - MARGIN;
  const leftRoom = anchor.left - GAP - size.width >= MARGIN;
  const left = right
    ? anchor.right + GAP
    : leftRoom
      ? anchor.left - GAP - size.width
      : viewport.width - MARGIN - size.width;
  const down = anchor.top - INSET + size.height <= viewport.height - MARGIN;
  return {
    left: clamp(left, MARGIN, viewport.width - MARGIN - size.width),
    top: clamp(
      down ? anchor.top - INSET : anchor.bottom + INSET - size.height,
      MARGIN,
      viewport.height - MARGIN - size.height,
    ),
    side: right || !leftRoom ? 'right' : 'left',
    flippedUp: !down,
  };
}

interface OpenSub {
  index: number;
  anchor: Anchor;
  /** Opened from the keyboard: its first row takes focus. */
  focus: boolean;
}

const viewport = (): Size => ({ width: window.innerWidth, height: window.innerHeight });

function useNarrow(): boolean {
  const [narrow] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 760px)').matches,
  );
  return narrow;
}

/**
 * The map's right-click menu, opened at a pointer position. Short top level, details in
 * submenus that open on hover (after a short delay), on click and on ArrowRight; one submenu per
 * level at a time, Escape or ArrowLeft closes it. Menus flip left and up at the viewport's edges.
 * On narrow screens it is a bottom sheet and a submenu replaces the sheet's rows, with a back row.
 */
export function ContextMenu({ title, note, x, y, items, onClose }: ContextMenuProps) {
  const layer = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState<OpenSub[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editing = useRef(false);
  const narrow = useNarrow();
  const pressed = useRef(false);

  const cancel = useCallback(() => clearTimeout(timer.current), []);
  const schedule = useCallback((fn: () => void, ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  }, []);
  useEffect(() => cancel, [cancel]);

  // The item lists along the open path; a path entry that no longer points at a submenu ends it.
  const levels: { items: MenuItem[]; label?: string }[] = [{ items, label: title }];
  for (const open of path) {
    const item = levels[levels.length - 1]!.items[open.index];
    if (item?.kind !== 'submenu') break;
    levels.push({ items: item.items, label: item.label });
  }

  const openSub = useCallback((level: number, index: number, row: HTMLElement, focus: boolean) => {
    const panel = row.closest<HTMLElement>('[role="menu"]');
    const r = row.getBoundingClientRect();
    const p = panel?.getBoundingClientRect() ?? r;
    const anchor = { left: p.left, right: p.right, top: r.top, bottom: r.bottom };
    setPath((current) => [...current.slice(0, level), { index, anchor, focus }]);
  }, []);
  const closeFrom = useCallback((level: number) => setPath((current) => current.slice(0, level)), []);
  /** Closes the submenu at `level` and gives the focus back to its trigger. */
  const back = useCallback(
    (level: number) => {
      const open = path[level - 1];
      if (open)
        layer.current
          ?.querySelector<HTMLElement>(`[data-level="${level - 1}"] [data-index="${open.index}"]`)
          ?.focus();
      closeFrom(level - 1);
    },
    [path, closeFrom],
  );

  useEffect(() => {
    const inside = (e: Event) => layer.current?.contains(e.target as Node) ?? false;
    const onPointer = (e: PointerEvent) => !inside(e) && onClose();
    const onWheel = (e: WheelEvent) => !inside(e) && onClose();
    // Focus may sit outside the menu (a click on its edge); Escape still closes it.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !inside(e) && onClose();
    // Registered after the opening event finished, so it does not close the menu at once.
    const start = setTimeout(() => {
      document.addEventListener('pointerdown', onPointer);
      document.addEventListener('wheel', onWheel, { passive: true });
    });
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    return () => {
      clearTimeout(start);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('wheel', onWheel);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const shared = { schedule, cancel, openSub, closeFrom, back, close: onClose, editing, narrow };
  const deepest = levels.length - 1;

  return (
    <div
      ref={layer}
      className={styles.layer}
      onPointerDownCapture={() => {
        pressed.current = true;
      }}
      onClickCapture={(e) => {
        // A long press opens the menu under the finger: the click that ends it began before the
        // menu existed and is not a choice. Keyboard clicks have no pointer (detail 0).
        if (e.detail > 0 && !pressed.current) {
          e.preventDefault();
          e.stopPropagation();
        }
        pressed.current = false;
      }}
    >
      {narrow && <div className={styles.backdrop} onClick={onClose} />}
      {levels.map((l, level) =>
        narrow && level !== deepest ? null : (
          <Panel
            // A different submenu at the same level is a new panel (focus, position, field).
            key={
              path
                .slice(0, level)
                .map((p) => p.index)
                .join('.') || 'root'
            }
            level={level}
            items={l.items}
            label={l.label}
            title={level === 0 ? title : undefined}
            note={level === 0 ? note : undefined}
            point={{ x, y }}
            open={path[level]}
            from={level > 0 ? path[level - 1] : undefined}
            {...shared}
          />
        ),
      )}
    </div>
  );
}

interface PanelProps {
  level: number;
  items: MenuItem[];
  label?: string;
  title?: string;
  note?: string;
  point: { x: number; y: number };
  /** The submenu open from this panel. */
  open?: OpenSub;
  /** How this panel (a submenu) was opened. */
  from?: OpenSub;
  schedule(fn: () => void, ms: number): void;
  cancel(): void;
  openSub(level: number, index: number, row: HTMLElement, focus: boolean): void;
  closeFrom(level: number): void;
  back(level: number): void;
  close(): void;
  editing: RefObject<boolean>;
  narrow: boolean;
}

function Panel(props: PanelProps) {
  const { level, items, label, title, note, point, open, from, narrow } = props;
  const { schedule, cancel, openSub, closeFrom, back, close, editing } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const [editAt, setEditAt] = useState<number | null>(null);
  const anchor = from?.anchor;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || narrow) return setStyle({});
    const { width, height } = el.getBoundingClientRect();
    const size = { width, height };
    const place = anchor ? placeBeside(anchor, size, viewport()) : placeAtPoint(point, size, viewport());
    setStyle({
      left: place.left,
      top: place.top,
      '--menu-from': place.side === 'right' ? '-4px' : '4px',
    } as CSSProperties);
  }, [anchor, point.x, point.y, items.length, narrow]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (from?.focus || (narrow && level > 0)) rows(el)[0]?.focus({ preventScroll: true });
    else if (level === 0) el.focus({ preventScroll: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: ReactKeyboardEvent) => {
    // The map's own shortcuts (F, C, L...) must not fire while the menu has the keyboard.
    e.stopPropagation();
    const el = ref.current;
    if (!el || (e.target as HTMLElement).tagName === 'INPUT') return;
    const list = rows(el);
    const at = list.indexOf(document.activeElement as HTMLElement);
    const focus = (i: number) => list[(i + list.length) % list.length]?.focus({ preventScroll: true });
    const current = at >= 0 ? list[at] : undefined;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        return focus(at < 0 ? 0 : at + 1);
      case 'ArrowUp':
        e.preventDefault();
        return focus(at < 0 ? list.length - 1 : at - 1);
      case 'Home':
        e.preventDefault();
        return focus(0);
      case 'End':
        e.preventDefault();
        return focus(list.length - 1);
      case 'ArrowRight':
        e.preventDefault();
        if (current?.dataset.sub !== undefined) openSub(level, Number(current.dataset.index), current, true);
        return;
      case 'ArrowLeft':
        e.preventDefault();
        if (level > 0) back(level);
        return;
      case 'Escape':
        e.preventDefault();
        return level > 0 ? back(level) : close();
      case 'Tab':
        e.preventDefault();
        return focus(e.shiftKey ? at - 1 : at + 1);
    }
    // Typeahead: the next row starting with the typed letter.
    if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const key = e.key.toLowerCase();
      const n = list.length;
      for (let step = 1; step <= n; step++) {
        const row = list[(Math.max(at, -1) + step) % n]!;
        if (row.textContent?.trim().toLowerCase().startsWith(key)) return row.focus({ preventScroll: true });
      }
    }
  };

  /** Hover moves the highlight (focus) and opens or closes submenus after a delay; mouse only. */
  const onRowEnter = (e: ReactPointerEvent<HTMLElement>, index: number, sub: boolean) => {
    if (e.pointerType !== 'mouse' || narrow) return;
    if (!editing.current) e.currentTarget.focus({ preventScroll: true });
    const row = e.currentTarget;
    if (sub) {
      if (open?.index === index) return cancel();
      schedule(() => openSub(level, index, row, false), open ? SWITCH_DELAY_MS : OPEN_DELAY_MS);
    } else if (open) {
      schedule(() => closeFrom(level), SWITCH_DELAY_MS);
    } else {
      cancel();
    }
  };
  const onRowLeave = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse' || editing.current) return;
    if (document.activeElement === e.currentTarget) ref.current?.focus({ preventScroll: true });
  };

  const hasLead = items.some(
    (i) =>
      ((i.kind === 'action' || i.kind === 'submenu' || i.kind === 'input' || i.kind === 'check') && i.icon) ||
      i.kind === 'radio' ||
      i.kind === 'check',
  );

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      data-level={level}
      data-narrow={narrow || undefined}
      className={styles.menu}
      style={style}
      onKeyDown={onKeyDown}
      onPointerEnter={(e) => e.pointerType === 'mouse' && level > 0 && cancel()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {narrow && <div className={styles.grabber} aria-hidden />}
      {title && <div className={styles.title}>{title}</div>}
      {note && <div className={styles.note}>{note}</div>}
      {narrow && level > 0 && (
        <button
          type="button"
          role="menuitem"
          data-row
          className={styles.item}
          data-back
          onClick={() => back(level)}
        >
          <span className={styles.lead}>
            <ChevronLeft />
          </span>
          <span className={styles.label}>{label}</span>
        </button>
      )}
      {items.map((item, i) => {
        const lead = (content: ReactNode) => hasLead && <span className={styles.lead}>{content}</span>;
        switch (item.kind) {
          case 'separator':
            return <hr key={i} className={styles.separator} />;
          case 'label':
            return (
              <div key={i} className={styles.groupLabel} role="presentation">
                {item.label}
              </div>
            );
          case 'custom':
            return (
              <div key={item.key} className={styles.custom} data-custom>
                {item.render(close)}
              </div>
            );
          case 'action':
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                data-row
                data-index={i}
                className={styles.item}
                data-danger={item.danger || undefined}
                onPointerEnter={(e) => onRowEnter(e, i, false)}
                onPointerLeave={onRowLeave}
                onClick={() => {
                  item.onSelect();
                  close();
                }}
              >
                {lead(item.icon)}
                <span className={styles.label}>{item.label}</span>
                {item.shortcut && <kbd className={styles.trail}>{item.shortcut}</kbd>}
              </button>
            );
          case 'check':
          case 'radio':
            return (
              <button
                key={i}
                type="button"
                role={item.kind === 'check' ? 'menuitemcheckbox' : 'menuitemradio'}
                aria-checked={item.checked}
                title={item.kind === 'check' ? item.title : undefined}
                data-row
                data-index={i}
                className={styles.item}
                onPointerEnter={(e) => onRowEnter(e, i, false)}
                onPointerLeave={onRowLeave}
                onClick={() => {
                  if (item.kind === 'radio' || level === 0) close();
                  item.onSelect();
                }}
              >
                {lead(
                  item.checked ? <Check className={styles.tick} /> : item.kind === 'check' ? item.icon : null,
                )}
                {item.swatch && <Swatch {...item.swatch} />}
                <span className={styles.label}>{item.label}</span>
                {item.kind === 'radio' && item.hint && <span className={styles.trail}>{item.hint}</span>}
              </button>
            );
          case 'submenu':
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={open?.index === i}
                data-row
                data-sub
                data-index={i}
                data-open={open?.index === i || undefined}
                className={styles.item}
                onPointerEnter={(e) => onRowEnter(e, i, true)}
                onPointerLeave={onRowLeave}
                onClick={(e) => {
                  cancel();
                  // A keyboard click (Enter, Space) has no pointer detail: move the focus in too.
                  openSub(level, i, e.currentTarget, e.detail === 0);
                }}
              >
                {lead(item.icon)}
                <span className={styles.label}>{item.label}</span>
                {item.hint && (
                  <span className={styles.trail}>
                    {item.hintSwatch && <Swatch {...item.hintSwatch} />}
                    {item.hint}
                  </span>
                )}
                <ChevronRight className={styles.chevron} aria-hidden />
              </button>
            );
          case 'input':
            return editAt === i ? (
              <div key={i} className={styles.item} data-editing>
                {lead(item.icon)}
                <input
                  className={styles.input}
                  aria-label={item.label}
                  defaultValue={item.value}
                  placeholder={item.placeholder}
                  maxLength={item.maxLength}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      editing.current = false;
                      const value = e.currentTarget.value.trim();
                      close();
                      if (value !== item.value) item.onSubmit(value);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      editing.current = false;
                      setEditAt(null);
                      requestAnimationFrame(() =>
                        ref.current?.querySelector<HTMLElement>(`[data-index="${i}"]`)?.focus(),
                      );
                    }
                  }}
                  onBlur={() => {
                    editing.current = false;
                    setEditAt(null);
                  }}
                />
                <kbd className={styles.trail}>↵</kbd>
              </div>
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                data-row
                data-index={i}
                className={styles.item}
                onPointerEnter={(e) => onRowEnter(e, i, false)}
                onPointerLeave={onRowLeave}
                onClick={() => {
                  editing.current = true;
                  closeFrom(level);
                  setEditAt(i);
                }}
              >
                {lead(item.icon)}
                <span className={styles.label}>{item.label}…</span>
                {item.hint && <span className={styles.trail}>{item.hint}</span>}
              </button>
            );
        }
      })}
    </div>
  );
}

function rows(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>('[data-row], [data-custom] button')];
}

function Swatch({ color, shape = 'dot', dashed }: MenuSwatch) {
  return (
    <span
      className={styles.swatch}
      data-shape={shape}
      data-dashed={dashed || undefined}
      data-empty={color === undefined || undefined}
      style={color ? ({ '--swatch': color } as CSSProperties) : undefined}
      aria-hidden
    />
  );
}
