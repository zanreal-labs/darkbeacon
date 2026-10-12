import type { CSSProperties, ReactNode } from 'react';
import { Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import { IconButton } from './Button';
import styles from './overlay.module.css';

export const Sheet = D.Root;
export const SheetTrigger = D.Trigger;
export const SheetClose = D.Close;

export interface SheetContentProps {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** `bottom` on phones (default), `right` or `left` for side panels. */
  side?: 'bottom' | 'right' | 'left';
  /** Width of side sheets in px. */
  width?: number;
  /** Hide the visible header (the title still names the sheet for screen readers). */
  hideHeader?: boolean;
}

/** A panel that slides in from an edge; on phones it replaces dialogs and side panels. */
export function SheetContent({
  title,
  description,
  children,
  side = 'bottom',
  width,
  hideHeader,
}: SheetContentProps) {
  return (
    <D.Portal>
      <D.Overlay className={styles.overlay} />
      <D.Content
        className={styles.sheet}
        data-side={side}
        style={width ? ({ '--sheet-width': `${width}px` } as CSSProperties) : undefined}
      >
        {side === 'bottom' && <div className={styles.grabber} aria-hidden />}
        <div className={hideHeader ? 'sr-only' : styles.dialogHeader}>
          <D.Title className={styles.dialogTitle}>{title}</D.Title>
          {description ? (
            <D.Description className={styles.dialogDescription}>{description}</D.Description>
          ) : (
            <D.Description className="sr-only">{title}</D.Description>
          )}
        </div>
        <div className={styles.dialogBody}>{children}</div>
        <D.Close asChild>
          <IconButton className={styles.close} label="Close" icon={<X />} size="sm" tooltip={false} />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
