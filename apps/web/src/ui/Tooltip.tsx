import type { ReactElement, ReactNode } from 'react';
import { Tooltip as T } from 'radix-ui';
import styles from './overlay.module.css';

/** Wrap the app once; tooltips share their open delay. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <T.Provider delayDuration={400} skipDelayDuration={200}>
      {children}
    </T.Provider>
  );
}

export interface TooltipProps {
  content: ReactNode;
  /** One focusable element (button, link). */
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

/** A short hint on hover and keyboard focus. Not for essential information on touch screens. */
export function Tooltip({ content, children, side = 'top', align = 'center' }: TooltipProps) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content className={styles.tooltip} side={side} align={align} sideOffset={6} collisionPadding={8}>
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
