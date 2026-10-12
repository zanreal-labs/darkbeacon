import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx';
import { useFieldControl } from './Field';
import styles from './field.module.css';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Icon inside the left edge (e.g. <Search />). */
  icon?: ReactNode;
  /** Element inside the right edge (e.g. a clear button or a unit). */
  trailing?: ReactNode;
  size?: 'sm' | 'md';
  /** Monospace with tabular figures, for ids and numbers. */
  mono?: boolean;
}

/** Text input. Inside a <Field> it takes the label, hint and error wiring automatically. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { icon, trailing, size = 'md', mono, className, id, ...rest },
  ref,
) {
  const field = useFieldControl();
  return (
    <div className={cx(styles.control, size === 'sm' && styles.sm, className)}>
      {icon}
      <input
        ref={ref}
        id={id ?? field?.id}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid || undefined}
        className={cx(styles.bare, mono && 'mono')}
        {...rest}
      />
      {trailing}
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, mono, id, rows = 4, ...rest },
  ref,
) {
  const field = useFieldControl();
  return (
    <div className={cx(styles.control, styles.textarea, className)}>
      <textarea
        ref={ref}
        id={id ?? field?.id}
        rows={rows}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid || undefined}
        className={cx(styles.bare, mono && 'mono')}
        {...rest}
      />
    </div>
  );
});
