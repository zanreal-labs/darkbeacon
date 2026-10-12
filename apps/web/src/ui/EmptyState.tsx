'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from './Button';
import styles from './display.module.css';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons; the first is usually the primary action. */
  actions?: ReactNode;
  tone?: 'default' | 'danger';
  /** Less padding, for panels and cards. */
  compact?: boolean;
}

/** What a screen shows when there is nothing yet: an icon, one line, and what to do next. */
export function EmptyState({
  icon,
  title,
  description,
  actions,
  tone = 'default',
  compact,
}: EmptyStateProps) {
  return (
    <div className={styles.empty} data-tone={tone} data-compact={compact || undefined}>
      {icon && <div className={styles.emptyIcon}>{icon}</div>}
      <div className={styles.emptyTitle}>{title}</div>
      {description && <div className={styles.emptyDescription}>{description}</div>}
      {actions && <div className={styles.emptyActions}>{actions}</div>}
    </div>
  );
}

/** Error state with a retry button; pass the error to show its message. */
export function ErrorState({
  title = 'Something went wrong',
  error,
  onRetry,
  compact,
}: {
  title?: ReactNode;
  error?: unknown;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const message =
    error instanceof Error && error.message ? error.message : 'Check your connection and try again.';
  return (
    <EmptyState
      tone="danger"
      compact={compact}
      icon={<AlertTriangle />}
      title={title}
      description={message}
      actions={
        onRetry && (
          <Button icon={<RotateCw />} onClick={onRetry}>
            Try again
          </Button>
        )
      }
    />
  );
}
