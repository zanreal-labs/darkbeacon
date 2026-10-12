'use client';

import { useState, type KeyboardEvent, type Ref } from 'react';
import styles from './sidebar.module.css';

/** A text value edited in place: saved on Enter or leaving the field, Escape puts it back. */
export function InlineText({
  label,
  value,
  placeholder,
  maxLength,
  mono,
  inputRef,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  maxLength: number;
  mono?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onCommit(value: string | null): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const next = draft.trim();
    setDraft(null);
    if (next !== value) onCommit(next === '' ? null : next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    else if (e.key === 'Escape') {
      setDraft(null);
      requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
    }
  };
  return (
    <input
      ref={inputRef}
      className={styles.inline}
      data-mono={mono || undefined}
      aria-label={label}
      maxLength={maxLength}
      placeholder={placeholder}
      value={draft ?? value}
      onFocus={() => setDraft(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}
