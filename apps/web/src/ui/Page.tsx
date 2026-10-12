'use client';

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import styles from './display.module.css';

/** Scrollable page column inside the shell. `width` is the max width in px (default 880). */
export function Page({
  width,
  className,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & { width?: number }) {
  return (
    <div
      className={cx(styles.page, className)}
      style={width ? ({ '--page-width': `${width}px`, ...style } as CSSProperties) : style}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageHeading}>
        <h1>{title}</h1>
        {description && <p className={styles.pageDescription}>{description}</p>}
      </div>
      {actions && <div className={styles.pageActions}>{actions}</div>}
    </header>
  );
}

/** Vertical rhythm between cards on a page. */
export function Stack({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(styles.stack, className)} {...props} />;
}
