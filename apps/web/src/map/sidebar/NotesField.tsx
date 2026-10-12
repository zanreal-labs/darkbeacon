'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { Markdown } from '../../components/Markdown';
import styles from './sidebar.module.css';

/**
 * Markdown notes. Shown rendered (links open in a new tab); editors click the text (or the empty
 * field) to edit the source, which grows with its text and is saved when the field is left or on
 * Ctrl+Enter. Escape drops the edit.
 */
export function NotesField({
  value,
  onCommit,
  editable,
  label = 'Notes',
  placeholder = 'Structures, who lives here, what to watch for… (Markdown)',
  maxLength = 10_000,
}: {
  value: string;
  onCommit?(value: string): void;
  editable: boolean;
  label?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const shown = draft ?? value;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 320)}px`;
  }, [shown, editing]);

  if (!editable) return value ? <Markdown className={styles.notesText} text={value} /> : null;

  if (value && !editing)
    return (
      <div
        className={styles.notesView}
        role="button"
        tabIndex={0}
        aria-label={`${label}: click to edit`}
        title="Click to edit"
        onClick={(e) => {
          // Links in the notes open; anything else starts editing.
          if ((e.target as HTMLElement).closest('a')) return;
          setEditing(true);
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setEditing(true);
          }
        }}
      >
        <Markdown text={value} />
      </div>
    );

  const commit = () => {
    setEditing(false);
    if (draft === null) return;
    setDraft(null);
    if (draft !== value) onCommit?.(draft);
  };
  return (
    <textarea
      ref={ref}
      className={styles.notes}
      aria-label={label}
      rows={2}
      maxLength={maxLength}
      placeholder={placeholder}
      value={shown}
      // Opened from the rendered text: straight into typing.
      autoFocus={editing}
      onFocus={() => {
        setDraft(value);
        setEditing(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
        else if (e.key === 'Escape') {
          setDraft(null);
          const el = e.currentTarget;
          requestAnimationFrame(() => el.blur());
        }
      }}
    />
  );
}
