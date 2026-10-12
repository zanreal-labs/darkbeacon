'use client';

import type { ReactNode } from 'react';
import { RadioGroup } from 'radix-ui';
import { Check } from 'lucide-react';
import { cx } from './cx';
import styles from './choice.module.css';

export interface ChoiceOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

/** One of a few options, each a card with a line of explanation (sign-in method, targets). */
export function ChoiceGroup({
  value,
  onValueChange,
  options,
  disabled,
  className,
  'aria-label': ariaLabel,
}: {
  value: string | undefined;
  onValueChange(value: string): void;
  options: readonly ChoiceOption[];
  disabled?: boolean;
  className?: string;
  'aria-label': string;
}) {
  return (
    <RadioGroup.Root
      className={cx(styles.group, className)}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {options.map((o) => (
        <RadioGroup.Item key={o.value} value={o.value} disabled={o.disabled} className={styles.option}>
          {o.icon && <span className={styles.icon}>{o.icon}</span>}
          <span className={styles.text}>
            <span className={styles.label}>{o.label}</span>
            {o.description && <span className={styles.description}>{o.description}</span>}
          </span>
          <span className={styles.check} aria-hidden>
            <RadioGroup.Indicator>
              <Check />
            </RadioGroup.Indicator>
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
