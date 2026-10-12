'use client';

import type { ReactNode } from 'react';
import { Checkbox as C, Switch as S } from 'radix-ui';
import { Check, Minus } from 'lucide-react';
import { useId } from 'react';
import styles from './field.module.css';

interface ToggleProps {
  checked: boolean | 'indeterminate';
  onCheckedChange(checked: boolean): void;
  label: ReactNode;
  /** Second line under the label. */
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** Checkbox with its label (and optional description) as one click target. */
export function Checkbox({ checked, onCheckedChange, label, description, disabled, className }: ToggleProps) {
  const id = useId();
  return (
    <label
      className={`${styles.check} ${className ?? ''}`}
      htmlFor={id}
      data-disabled={disabled || undefined}
    >
      <C.Root
        id={id}
        className={styles.checkbox}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        aria-describedby={description ? `${id}-d` : undefined}
      >
        <C.Indicator>{checked === 'indeterminate' ? <Minus /> : <Check />}</C.Indicator>
      </C.Root>
      <span className={styles.checkText}>
        <span>{label}</span>
        {description && (
          <span id={`${id}-d`} className={styles.hint}>
            {description}
          </span>
        )}
      </span>
    </label>
  );
}

/** On/off switch for settings that apply at once. */
export function Switch({ checked, onCheckedChange, label, description, disabled, className }: ToggleProps) {
  const id = useId();
  return (
    <label
      className={`${styles.check} ${className ?? ''}`}
      htmlFor={id}
      data-disabled={disabled || undefined}
    >
      <S.Root
        id={id}
        className={styles.switch}
        checked={checked === true}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-describedby={description ? `${id}-d` : undefined}
      >
        <S.Thumb className={styles.thumb} />
      </S.Root>
      <span className={styles.checkText}>
        <span>{label}</span>
        {description && (
          <span id={`${id}-d`} className={styles.hint}>
            {description}
          </span>
        )}
      </span>
    </label>
  );
}
