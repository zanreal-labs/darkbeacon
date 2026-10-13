'use client';

import { useId, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useSectionPlacement } from './layout';
import styles from './sidebar.module.css';

interface Props {
  id: string;
  title: string;
  /** Shown after the title (signatures, pilots); nothing when undefined. */
  count?: number;
  /**
   * A few words after the count, folded or not ("3 unscanned", "1 reinforced 04:12:09"), so the
   * title bar alone says what is in the section.
   */
  summary?: ReactNode;
  /** Draws the summary in the warning colour: something there needs a look. */
  alert?: boolean;
  /** Actions on the right of the title bar. */
  action?: ReactNode;
  collapsed: boolean;
  onToggle(id: string): void;
  children: ReactNode;
}

/** One part of the system sidebar: a compact title bar that folds it, and its content. */
export function SidebarSection({
  id,
  title,
  count,
  summary,
  alert,
  action,
  collapsed,
  onToggle,
  children,
}: Props) {
  const bodyId = useId();
  // My layout may hide the section or move it (see `layout.tsx`).
  const placement = useSectionPlacement(id);
  if (placement?.hidden) return null;
  return (
    <section
      className={styles.section}
      style={placement ? { order: placement.order } : undefined}
      data-section={id}
      data-collapsed={collapsed || undefined}
      aria-label={title}
    >
      <header className={styles.sectionHeader}>
        <button
          type="button"
          className={styles.sectionToggle}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => onToggle(id)}
        >
          <ChevronRight className={styles.chevron} aria-hidden />
          <span className={styles.sectionTitle}>{title}</span>
          {count !== undefined && (
            <span className={styles.sectionCount} data-zero={count === 0 || undefined}>
              {count}
            </span>
          )}
          {summary ? (
            <span className={styles.sectionSummary} data-alert={alert || undefined}>
              {summary}
            </span>
          ) : null}
        </button>
        {action && <div className={styles.sectionAction}>{action}</div>}
      </header>
      {!collapsed && (
        <div id={bodyId} className={styles.sectionBody}>
          {children}
        </div>
      )}
    </section>
  );
}
