'use client';

import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import styles from './display.module.css';

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cx(styles.card, className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <header className={styles.cardHeader}>
      {icon}
      <div className={styles.cardHeading}>
        <h2 className={styles.cardTitle}>{title}</h2>
        {description && <p className={styles.cardDescription}>{description}</p>}
      </div>
      {actions && <div className={styles.cardActions}>{actions}</div>}
    </header>
  );
}

/** `flush` removes the padding for edge-to-edge lists (<Rows>). */
export function CardBody({
  flush,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { flush?: boolean }) {
  return <div className={cx(styles.cardBody, className)} data-flush={flush || undefined} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <footer className={cx(styles.cardFooter, className)} {...props} />;
}

/** A divided list for cards: characters, maps, accounts, plugins. */
export function Rows({ className, ...props }: HTMLAttributes<HTMLUListElement>) {
  return <ul className={cx(styles.rows, className)} {...props} />;
}

export function Row({
  leading,
  title,
  meta,
  actions,
  className,
}: {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <li className={cx(styles.row, className)}>
      {leading}
      <div className={styles.rowMain}>
        <div className={styles.rowTitle}>{title}</div>
        {meta && <div className={styles.rowMeta}>{meta}</div>}
      </div>
      {actions}
    </li>
  );
}
