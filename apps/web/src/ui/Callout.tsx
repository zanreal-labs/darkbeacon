'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { Tone } from './Badge';
import styles from './display.module.css';

const ICON: Record<Tone, ReactNode> = {
  neutral: <Info />,
  accent: <Info />,
  success: <CheckCircle2 />,
  warning: <AlertTriangle />,
  danger: <XCircle />,
};

/** An inline notice: auth errors, configuration hints, warnings before destructive actions. */
export function Callout({
  tone = 'neutral',
  title,
  children,
  icon,
  role,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  role?: 'alert' | 'status';
}) {
  return (
    <div className={styles.callout} data-tone={tone} role={role ?? (tone === 'danger' ? 'alert' : undefined)}>
      {icon ?? ICON[tone]}
      <div className={styles.calloutBody}>
        {title && <div className={styles.calloutTitle}>{title}</div>}
        {children && <div className={styles.calloutText}>{children}</div>}
      </div>
    </div>
  );
}
