'use client';

import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { Tabs as T, ToggleGroup } from 'radix-ui';
import { cx } from './cx';
import styles from './tabs.module.css';

/** Tabs for sections of one page (admin, settings). Arrow keys move between tabs. */
export const Tabs = T.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof T.List>) {
  const list = useRef<HTMLDivElement>(null);
  const shown = useRef<Element | null>(null);
  // On narrow screens the list scrolls sideways: keep the open tab in view (e.g. opened by ?tab=).
  useEffect(() => {
    const active = list.current?.querySelector('[role="tab"][data-state="active"]') ?? null;
    if (!active || active === shown.current) return;
    shown.current = active;
    const box = list.current!;
    const tab = active.getBoundingClientRect();
    const frame = box.getBoundingClientRect();
    if (tab.right > frame.right) box.scrollLeft += tab.right - frame.right + 16;
    else if (tab.left < frame.left) box.scrollLeft -= frame.left - tab.left + 16;
  });
  return <T.List ref={list} className={cx(styles.list, className)} {...props} />;
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
