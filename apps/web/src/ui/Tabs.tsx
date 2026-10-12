'use client';

import type { ComponentProps, ReactNode } from 'react';
import { Tabs as T, ToggleGroup } from 'radix-ui';
import { cx } from './cx';
import styles from './tabs.module.css';

/** Tabs for sections of one page (admin, settings). Arrow keys move between tabs. */
export const Tabs = T.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof T.List>) {
  return <T.List className={cx(styles.list, className)} {...props} />;
}

export function TabsTrigger({
  icon,
  children,
  className,
  ...props
}: ComponentProps<typeof T.Trigger> & { icon?: ReactNode }) {
  return (
    <T.Trigger className={cx(styles.trigger, className)} {...props}>
      {icon}
      {children}
    </T.Trigger>
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof T.Content>) {
  return <T.Content className={cx(styles.content, className)} {...props} />;
}

export interface SegmentedOption {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
}

/** A small single-choice control (e.g. System / Light / Dark). */
export function Segmented({
  value,
  onValueChange,
  options,
  'aria-label': label,
  className,
}: {
  value: string;
  onValueChange(value: string): void;
  options: readonly SegmentedOption[];
  'aria-label': string;
  className?: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onValueChange(v)}
      aria-label={label}
      className={cx(styles.segmented, className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item key={o.value} value={o.value} className={styles.segment}>
          {o.icon}
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
