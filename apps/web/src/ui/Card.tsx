'use client';

import { ChevronDown } from 'lucide-react';
import { useState, type HTMLAttributes, type ReactNode } from 'react';
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

export interface DisclosureProps {
  /** An icon before the title (16 px). */
  icon?: ReactNode;
  title: ReactNode;
  /** A short note at the end of the closed head, only when it says what the body would not. */
  summary?: ReactNode;
  /** Tints the icon: something in the body wants attention. */
  warn?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

/** A card that folds its body away: the head opens it, and the body opens inside the card. */
export function Disclosure({
  icon,
  title,
  summary,
  warn,
  defaultOpen = false,
  children,
  className,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={cx(styles.disclosure, className)} data-open={open || undefined}>
      <button
        type="button"
        className={styles.disclosureHead}
        aria-expanded={open}
        data-warn={warn || undefined}
        onClick={() => setOpen(!open)}
      >
        {icon}
        <span className={styles.disclosureTitle}>{title}</span>
        {summary && <span className={styles.disclosureSummary}>{summary}</span>}
        <ChevronDown aria-hidden className={styles.disclosureChevron} />
      </button>
      {open && <div className={styles.disclosureBody}>{children}</div>}
    </section>
  );
}
