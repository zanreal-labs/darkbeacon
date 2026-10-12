import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Slot } from 'radix-ui';
import { cx } from './cx';
import { Tooltip } from './Tooltip';
import styles from './button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost' | 'discord';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string | undefined> = {
  primary: styles.primary,
  secondary: styles.secondary,
  ghost: styles.ghost,
  danger: styles.danger,
  'danger-ghost': styles.dangerGhost,
  discord: styles.discord,
};
const SIZE: Record<ButtonSize, string | undefined> = { sm: styles.sm, md: undefined, lg: styles.lg };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, keeps the width and blocks clicks. */
  loading?: boolean;
  /** Full width. */
  block?: boolean;
  /** Icon before the label (lucide-react element). */
  icon?: ReactNode;
  /** Icon after the label. */
  trailingIcon?: ReactNode;
  /** Render the child element (e.g. a router <Link> or <a>) with button styles. */
  asChild?: boolean;
}

/** Buttons: primary for the one main action of a view, secondary by default, ghost in toolbars. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    block = false,
    icon,
    trailingIcon,
    asChild = false,
    className,
    children,
    disabled,
    type,
    ...rest
  },
  ref,
) {
  const classes = cx(
    styles.button,
    VARIANT[variant],
    SIZE[size],
    block && styles.block,
    loading && styles.loading,
    className,
  );
  if (asChild) {
    return (
      <Slot.Root ref={ref} className={classes} {...rest}>
        {icon}
        <Slot.Slottable>{children}</Slot.Slottable>
        {trailingIcon}
      </Slot.Root>
    );
  }
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {icon}
      {children !== undefined && children !== null && <span>{children}</span>}
      {trailingIcon}
      {loading && (
        <span className={styles.spinner} aria-hidden>
          <span className={styles.spin} />
        </span>
      )}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'trailingIcon' | 'children' | 'block'> {
  /** Accessible name, also shown as a tooltip. */
  label: string;
  icon: ReactNode;
  /** With `asChild`: the element (e.g. a router <Link>) that becomes the button. */
  children?: ReactNode;
  /** Set false when a surrounding element already explains the button. */
  tooltip?: boolean;
}

/** A square button with only an icon; `label` is its accessible name and tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, tooltip = true, variant = 'ghost', className, ...rest },
  ref,
) {
  const button = (
    <Button
      ref={ref}
      variant={variant}
      aria-label={label}
      className={cx(styles.icon, className)}
      icon={icon}
      {...rest}
    />
  );
  return tooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
});

/** Inline spinner for loading states outside buttons. */
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className={styles.spin} role="status" aria-label={label} />;
}
