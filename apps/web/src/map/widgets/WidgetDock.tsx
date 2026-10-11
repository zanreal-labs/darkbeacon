import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import styles from './WidgetDock.module.css';

export interface DockTab {
  id: string;
  title: string;
  icon: IconName;
  render(): ReactNode;
}

interface Props {
  tabs: DockTab[];
  active: string;
  open: boolean;
  onChange(active: string, open: boolean): void;
}

/** Side panel on wide screens, bottom dock with a sheet on phones. Same tabs, same content. */
export function WidgetDock({ tabs, active, open, onChange }: Props) {
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <aside className={styles.dock} data-open={open || undefined} aria-label="Widgets">
      <div className={styles.tabs} role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={open && t.id === current?.id}
            className={styles.tab}
            onClick={() => onChange(t.id, !(open && t.id === current?.id))}
          >
            <Icon name={t.icon} size={15} />
            <span>{t.title}</span>
          </button>
        ))}
      </div>
      {open && current && (
        <div className={styles.panel} role="tabpanel" aria-label={current.title}>
          {current.render()}
        </div>
      )}
    </aside>
  );
}
