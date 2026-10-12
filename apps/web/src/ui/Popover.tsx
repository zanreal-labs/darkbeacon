'use client';

import type { ComponentProps, CSSProperties } from 'react';
import { Popover as P } from 'radix-ui';
import { cx } from './cx';
import styles from './overlay.module.css';

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverClose = P.Close;
export const PopoverAnchor = P.Anchor;

/**
 * A floating panel next to its trigger (lists with a search field, small forms). Escape and a
 * click outside close it. `width` in px; it never gets wider than the screen.
 */
export function PopoverContent({
  className,
  width,
  style,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof P.Content> & { width?: number }) {
  return (
    <P.Portal>
      <P.Content
        className={cx(styles.surface, styles.popover, className)}
        sideOffset={sideOffset}
        collisionPadding={12}
        style={{ ...(width ? ({ '--popover-width': `${width}px` } as CSSProperties) : {}), ...style }}
        {...props}
      />
    </P.Portal>
  );
}
