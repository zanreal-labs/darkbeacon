'use client';

import { useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import { Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import { Button, IconButton, type ButtonVariant } from './Button';
import { cx } from './cx';
import styles from './overlay.module.css';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;
export const DialogTitle = D.Title;
export const DialogDescription = D.Description;

export interface DialogContentProps {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons, right-aligned under a divider. */
  footer?: ReactNode;
  /** Max width in px (default 480). */
  width?: number;
  /** On phones, fill the screen (a full-height sheet) instead of floating; for long forms. */
  sheetOnPhone?: boolean;
  /** Escape was pressed; `event.preventDefault()` keeps the dialog open. */
  onEscapeKeyDown?(event: KeyboardEvent): void;
}

/** A centred modal with a title, optional description, body and footer. Escape and the X close it. */
export function DialogContent({
  title,
  description,
  children,
  footer,
  width,
  sheetOnPhone,
  onEscapeKeyDown,
}: DialogContentProps) {
  return (
    <D.Portal>
      <D.Overlay className={styles.overlay} />
      <D.Content
        className={cx(styles.dialog, sheetOnPhone && styles.phoneSheet)}
        onEscapeKeyDown={onEscapeKeyDown}
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

export interface DialogSheetProps extends Omit<ComponentProps<typeof D.Content>, 'asChild' | 'style'> {
  /** Width in px on wider screens (default 960). */
  width?: number;
  /** Height in px on wider screens (default 720); never more than the window. */
  height?: number;
}

/**
 * A large modal whose inside the caller lays out (map settings: sections beside their content).
 * It keeps one size whatever is inside, so switching sections does not make it jump; on phones it
 * fills the screen. Escape, a click outside and `DialogClose` close it. It needs a `DialogTitle`.
 */
export function DialogSheet({ width, height, className, children, ...props }: DialogSheetProps) {
  const size = {
    ...(width ? { '--dialog-width': `${width}px` } : {}),
    ...(height ? { '--dialog-height': `${height}px` } : {}),
  } as CSSProperties;
  return (
    <D.Portal>
      <D.Overlay className={styles.overlay} />
      <D.Content className={cx(styles.dialog, styles.sheet, className)} style={size} {...props}>
        {children}
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
