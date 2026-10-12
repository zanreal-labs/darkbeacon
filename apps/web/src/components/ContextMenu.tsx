import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import styles from './ContextMenu.module.css';

export type MenuItem =
  | { kind: 'action'; label: string; onSelect(): void; danger?: boolean; icon?: ReactNode; shortcut?: string }
  | { kind: 'toggle'; label: string; checked: boolean; onSelect(): void; icon?: ReactNode }
  | {
      kind: 'choice';
      label: string;
      value: string;
      /** `color` is any CSS colour, usually `var(--dbk-...)`. */
      options: { value: string; label: string; color?: string }[];
      onSelect(value: string): void;
    }
  | {
      /** Several options on or off at once (labels). */
      kind: 'multi';
      label: string;
      options: { value: string; label: string; color?: string; checked: boolean; title?: string }[];
      onToggle(value: string): void;
    }
  | { kind: 'separator' }
  | { kind: 'custom'; key: string; render(close: () => void): ReactNode };

export interface ContextMenuProps {
  title?: string;
  x: number;
  y: number;
  items: MenuItem[];
  onClose(): void;
}

/**
 * Menu at a pointer position; on narrow screens it becomes a bottom sheet. Selecting an
 * action closes it; choices and toggles keep it open so several fields can be set in a row.
 */
export function ContextMenu({ title, x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ left: x, top: y, visibility: 'hidden' });
  // Actions get the same indent as toggles and icons so labels line up.
  const hasLeading = items.some((i) => (i.kind === 'toggle' || i.kind === 'action') && i.icon !== undefined);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    setPos({
      left: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
    });
  }, [x, y]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
      if (buttons.length === 0) return;
      e.preventDefault();
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      buttons[(at + step + buttons.length) % buttons.length]?.focus();
    };
    // Registered after the opening event finished, so it does not close the menu at once.
    const timer = setTimeout(() => document.addEventListener('pointerdown', onPointer));
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, []);

  return (
    <>
      <div className={styles.backdrop} />
      <div ref={ref} role="menu" aria-label={title} className={styles.menu} style={pos}>
        <div className={styles.grabber} aria-hidden />
        {title && <div className={styles.title}>{title}</div>}
        {items.map((item, i) => {
          switch (item.kind) {
            case 'separator':
              return <hr key={i} className={styles.separator} />;
            case 'custom':
              return <div key={item.key}>{item.render(onClose)}</div>;
            case 'action':
              return (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  className={styles.item}
                  data-danger={item.danger || undefined}
                  onClick={() => {
                    item.onSelect();
                    onClose();
                  }}
                >
                  {hasLeading && <span className={styles.lead}>{item.icon}</span>}
                  <span className={styles.itemLabel}>{item.label}</span>
                  {item.shortcut && <kbd className={styles.shortcut}>{item.shortcut}</kbd>}
                </button>
              );
            case 'toggle':
              return (
                <button
                  key={i}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={item.checked}
                  className={styles.item}
                  onClick={item.onSelect}
                >
                  {hasLeading && <span className={styles.lead}>{item.icon}</span>}
                  <span className={styles.itemLabel}>{item.label}</span>
                  <span className={styles.switch} data-on={item.checked || undefined} aria-hidden />
                </button>
              );
            case 'choice':
              return (
                <div key={i} className={styles.choice} role="group" aria-label={item.label}>
                  <span className={styles.choiceLabel}>{item.label}</span>
                  <div className={styles.options}>
                    {item.options.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={o.value === item.value}
                        className={styles.option}
                        style={o.color ? ({ '--option-color': o.color } as CSSProperties) : undefined}
                        onClick={() => item.onSelect(o.value)}
                      >
                        {o.color && <span className={styles.dot} />}
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            case 'multi':
              return (
                <div key={i} className={styles.choice} role="group" aria-label={item.label}>
                  <span className={styles.choiceLabel}>{item.label}</span>
                  <div className={styles.options}>
                    {item.options.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={o.checked}
                        title={o.title}
                        className={styles.option}
                        data-multi
                        style={o.color ? ({ '--option-color': o.color } as CSSProperties) : undefined}
                        onClick={() => item.onToggle(o.value)}
                      >
                        {o.checked ? (
                          <Check className={styles.tick} />
                        ) : (
                          o.color && <span className={styles.swatch} />
                        )}
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
          }
        })}
      </div>
    </>
  );
}
