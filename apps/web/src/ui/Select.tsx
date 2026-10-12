'use client';

import type { ReactNode } from 'react';
import { Select as S } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cx } from './cx';
import { useFieldControl } from './Field';
import fieldStyles from './field.module.css';
import styles from './overlay.module.css';

export interface SelectOption {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  value: string | undefined;
  onValueChange(value: string): void;
  options: readonly SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** Needed outside a <Field>. */
  'aria-label'?: string;
  className?: string;
}

/** A styled select (keyboard and screen-reader friendly). Values must be non-empty strings. */
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  size = 'md',
  className,
  ...aria
}: SelectProps) {
  const field = useFieldControl();
  return (
    <S.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <S.Trigger
        id={field?.id}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid || undefined}
        aria-label={aria['aria-label']}
        className={cx(
          fieldStyles.control,
          fieldStyles.selectTrigger,
          size === 'sm' && fieldStyles.sm,
          className,
        )}
      >
        <span className={fieldStyles.selectValue}>
          <S.Value placeholder={placeholder} />
        </span>
        <S.Icon asChild>
          <ChevronDown />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content className={cx(styles.surface, styles.selectContent)} position="popper" sideOffset={4}>
          <S.Viewport className={styles.selectViewport}>
            {options.map((o) => (
              <S.Item key={o.value} value={o.value} disabled={o.disabled} className={styles.item}>
                {o.icon}
                <S.ItemText>{o.label}</S.ItemText>
                <S.ItemIndicator className={styles.itemIndicator}>
                  <Check />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
