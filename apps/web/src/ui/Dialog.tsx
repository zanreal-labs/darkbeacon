'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import { Button, IconButton, type ButtonVariant } from './Button';
import styles from './overlay.module.css';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export interface DialogContentProps {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons, right-aligned under a divider. */
  footer?: ReactNode;
  /** Max width in px (default 480). */
  width?: number;
}

/** A centred modal with a title, optional description, body and footer. Escape and the X close it. */
export function DialogContent({ title, description, children, footer, width }: DialogContentProps) {
  return (
    <D.Portal>
      <D.Overlay className={styles.overlay} />
      <D.Content
        className={styles.dialog}
        style={width ? ({ '--dialog-width': `${width}px` } as CSSProperties) : undefined}
      >
        <div className={styles.dialogHeader}>
          <D.Title className={styles.dialogTitle}>{title}</D.Title>
          {description ? (
            <D.Description className={styles.dialogDescription}>{description}</D.Description>
          ) : (
            <D.Description className="sr-only">{title}</D.Description>
          )}
        </div>
        {children && <div className={styles.dialogBody}>{children}</div>}
        {!children && <div style={{ height: 'var(--dbk-space-4)' }} />}
        {footer && <div className={styles.dialogFooter}>{footer}</div>}
        <D.Close asChild>
          <IconButton className={styles.close} label="Close" icon={<X />} size="sm" tooltip={false} />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for destructive actions. */
  tone?: 'default' | 'danger';
  /** May return a promise; the dialog stays open with a spinner until it settles. */
  onConfirm(): unknown;
}

/** Replaces `window.confirm`: a small dialog with Cancel and one confirm button. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const variant: ButtonVariant = tone === 'danger' ? 'danger' : 'primary';
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        description={description}
        width={420}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">{cancelLabel}</Button>
            </DialogClose>
            <Button variant={variant} loading={busy} onClick={() => void confirm()}>
              {confirmLabel}
            </Button>
          </>
        }
      />
    </Dialog>
  );
}
