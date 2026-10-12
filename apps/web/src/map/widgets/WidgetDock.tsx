'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PanelRightClose } from 'lucide-react';
import { IconButton } from '../../ui';
import styles from './WidgetDock.module.css';

export interface DockTab {
  id: string;
  title: string;
  icon: ReactNode;
  /** Small count after the title (e.g. signatures in the system). */
  count?: number;
  render(): ReactNode;
}

interface Props {
  tabs: DockTab[];
  active: string;
  open: boolean;
  onChange(active: string, open: boolean): void;
}

/**
 * Keeps a tab strip that is wider than its room usable: it scrolls sideways (a mouse wheel too),
 * fades at the side that has more tabs, and brings the active tab into view. Answers which sides
 * have hidden tabs.
 */
function useTabStrip(active: string | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ start: false, end: false });

  useEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    const update = () => {
      const start = strip.scrollLeft > 1;
      const end = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
      setMore((m) => (m.start === start && m.end === end ? m : { start, end }));
    };
    const wheel = (event: WheelEvent) => {
      if (strip.scrollWidth <= strip.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      strip.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(strip);
    strip.addEventListener('scroll', update, { passive: true });
    strip.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer?.disconnect();
      strip.removeEventListener('scroll', update);
      strip.removeEventListener('wheel', wheel);
    };
  }, []);

  // Scrolls only the strip (scrollIntoView would also move the page around it).
  useEffect(() => {
    const strip = ref.current;
    const tab = [...(strip?.children ?? [])].find(
      (el): el is HTMLElement => el instanceof HTMLElement && el.dataset.tab === active,
    );
    if (!strip || !tab) return;
    const left = tab.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft) strip.scrollLeft = left - 8;
    else if (left + tab.offsetWidth > strip.scrollLeft + strip.clientWidth)
      strip.scrollLeft = left + tab.offsetWidth - strip.clientWidth + 8;
  }, [active]);

  return { ref, more };
}

/**
 * Side panel on wide screens, bottom tab bar with a sheet above it on phones. Same tabs, same
 * content. Clicking the open tab closes the panel. Any number of tabs fits: plugins add their
 * widgets here, and the strip scrolls when they do not fit.
 */
export function WidgetDock({ tabs, active, open, onChange }: Props) {
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  const { ref: stripRef, more } = useTabStrip(current?.id);
  return (
    <aside className={styles.dock} data-open={open || undefined} aria-label="Widgets">
      <div className={styles.frame}>
        <div className={styles.header}>
          <div
            ref={stripRef}
            className={styles.tabs}
            role="tablist"
            aria-label="Widgets"
            data-more-start={more.start || undefined}
            data-more-end={more.end || undefined}
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                data-tab={t.id}
                aria-selected={open && t.id === current?.id}
                title={t.title}
                className={styles.tab}
                onClick={() => onChange(t.id, !(open && t.id === current?.id))}
              >
                {t.icon}
                <span className={styles.tabTitle}>{t.title}</span>
                {t.count !== undefined && t.count > 0 && <span className={styles.count}>{t.count}</span>}
              </button>
            ))}
          </div>
          {open && (
            <IconButton
              className={styles.collapse}
              size="sm"
              label="Hide panel"
              icon={<PanelRightClose />}
              onClick={() => onChange(current?.id ?? active, false)}
            />
          )}
        </div>
        {open && current && (
          <div className={styles.panel} role="tabpanel" aria-label={current.title}>
            {current.render()}
          </div>
        )}
      </div>
    </aside>
  );
}
