'use client';

import type { ReactNode } from 'react';
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
 * Side panel on wide screens, bottom tab bar with a sheet above it on phones. Same tabs, same
 * content. Clicking the open tab closes the panel.
 */
export function WidgetDock({ tabs, active, open, onChange }: Props) {
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <aside className={styles.dock} data-open={open || undefined} aria-label="Widgets">
      <div className={styles.frame}>
        <div className={styles.header}>
          <div className={styles.tabs} role="tablist" aria-label="Widgets">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={open && t.id === current?.id}
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
