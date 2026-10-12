'use client';

import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';
import styles from './display.module.css';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export interface BadgeProps {
  children: ReactNode;
  tone?: Tone;
  variant?: 'soft' | 'outline';
  icon?: ReactNode;
  /** Any CSS colour (e.g. `cssVar('security-high')` or a label colour); overrides the tone. */
  color?: string;
  /** Shows a small dot in the badge colour before the text. */
  dot?: boolean;
  title?: string;
  className?: string;
}

/** Small status label: roles, map states, EOL/critical, security class. */
export function Badge({
  children,
  tone = 'neutral',
  variant = 'soft',
  icon,
  color,
  dot,
  title,
  className,
}: BadgeProps) {
  return (
    <span
      className={cx(styles.badge, className)}
      data-tone={tone}
      data-variant={variant}
      data-color={color ? '' : undefined}
      style={color ? ({ '--badge-color': color } as CSSProperties) : undefined}
      title={title}
    >
      {dot && <span className={styles.dot} aria-hidden />}
      {icon}
      {children}
    </span>
  );
}

/** A coloured dot; `pulse` for live states. Give it a label when it carries meaning on its own. */
export function StatusDot({ color, pulse, label }: { color: string; pulse?: boolean; label?: string }) {
  return (
    <span
      className={styles.dot}
      style={{ color }}
      data-pulse={pulse || undefined}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={styles.kbd}>{children}</kbd>;
}
