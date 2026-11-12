'use client';

import { createContext, useContext, useId, type ReactNode } from 'react';
import { cx } from './cx';
import styles from './field.module.css';

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** Ids and aria for the control inside a <Field>; controls read it themselves. */
export function useFieldControl(): FieldContextValue | null {
  return useContext(FieldContext);
}

export interface FieldProps {
  label: ReactNode;
  /** One line under the control. */
  hint?: ReactNode;
  /** Replaces the hint and marks the control invalid. */
  error?: ReactNode;
  optional?: boolean;
  /** The label is for screen readers only (the control's placeholder says what it is). */
  hideLabel?: boolean;
  children: ReactNode;
  className?: string;
}

/** Label, control, hint and error, wired together with ids and aria-describedby. */
export function Field({ label, hint, error, optional, hideLabel, children, className }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const message = error ?? hint;
  return (
    <FieldContext.Provider value={{ id, describedBy: message ? hintId : undefined, invalid: !!error }}>
      <div className={cx(styles.field, className)}>
        <label className={hideLabel ? 'sr-only' : styles.label} htmlFor={id}>
          {label}
          {optional && <span className={styles.optional}>optional</span>}
        </label>
        {children}
        {message && (
          <div
            id={hintId}
            className={error ? styles.fieldError : styles.hint}
            role={error ? 'alert' : undefined}
          >
            {message}
          </div>
        )}
      </div>
    </FieldContext.Provider>
  );
}
