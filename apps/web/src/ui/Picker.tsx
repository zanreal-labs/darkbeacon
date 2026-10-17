'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { Avatar } from './Avatar';
import { IconButton, Spinner } from './Button';
import { cx } from './cx';
import { useFieldControl } from './Field';
import fieldStyles from './field.module.css';
import styles from './picker.module.css';

export interface PickerOption {
  /** Unique within the results. */
  key: string;
  label: string;
  /** A ticker, a server name, a second line. */
  detail?: string | null;
  imageUrl?: string | null;
  /** Rounded square images (logos), circles otherwise (people). */
  shape?: 'circle' | 'rounded';
}

export interface PickerResults<T extends PickerOption> {
  options: T[];
  /** Shown under the results, e.g. how to get better ones. */
  note?: ReactNode;
}

export interface SearchPickerProps<T extends PickerOption> {
  /** The picked option, or null. */
  value: T | null;
  onChange(value: T | null): void;
  /** Answers a search; `cacheKey` keeps answers apart (e.g. the kind of thing searched). */
  search(text: string): Promise<PickerResults<T>>;
  cacheKey: readonly unknown[];
  placeholder?: string;
  /**
   * Fewer characters than this are not searched. 0: `search('')` answers on focus, before
   * anything is typed (suggestions, shown in the same rows as results).
   */
  minLength?: number;
  /**
   * How long typing must pause before a search, in ms. 0 for searches that cost nothing (in the
   * browser): they show no spinner either.
   */
  debounce?: number;
  /** What to say when nothing matched. */
  empty?: ReactNode;
  disabled?: boolean;
  'aria-label'?: string;
}

/**
 * A search-as-you-type picker: names in, a choice of people, corporations, alliances or servers
 * out, never a raw id. The list opens under the input; arrows move, Enter picks, Escape closes.
 */
export function SearchPicker<T extends PickerOption>({
  value,
  onChange,
  search,
  cacheKey,
  placeholder,
  minLength = 1,
  debounce = 250,
  empty = 'Nothing found',
  disabled,
  ...aria
}: SearchPickerProps<T>) {
  const field = useFieldControl();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text.trim()), debounce);
    return () => clearTimeout(timer);
  }, [text, debounce]);

  const enabled = debounced.length >= minLength;
  const results = useQuery({
    queryKey: ['picker', ...cacheKey, debounced],
    queryFn: () => search(debounced),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    // The previous answer stays while the next one comes, so the list never blinks empty.
    placeholderData: keepPreviousData,
  });
  const options = enabled ? (results.data?.options ?? []) : [];
  const waiting = results.isPending || (results.isPlaceholderData && options.length === 0);

  const pick = (option: T) => {
    onChange(option);
    setText('');
    setDebounced('');
    setOpen(false);
  };

  if (value) {
    return (
      <div className={cx(fieldStyles.control, styles.chosen)} data-disabled={disabled || undefined}>
        {value.imageUrl !== undefined && (
          <Avatar src={value.imageUrl} name={value.label} size={22} shape={value.shape ?? 'circle'} />
        )}
        <span className={styles.chosenLabel} id={field?.id}>
          {value.label}
          {value.detail && <span className={styles.detail}>{value.detail}</span>}
        </span>
        <IconButton
          size="sm"
          label="Choose another"
          icon={<X />}
          disabled={disabled}
          tooltip={false}
          onClick={() => {
            onChange(null);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        />
      </div>
    );
  }

  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(options.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      // Not while the list still shows the answer to earlier text.
      if (open && options[active] && !results.isPlaceholderData) {
        e.preventDefault();
        pick(options[active]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  // Nothing to suggest before typing: no list at all, rather than "nothing found".
  const nothingToSuggest = text.trim() === '' && !waiting && options.length === 0 && !results.isError;
  const showList = open && text.trim().length >= minLength && !nothingToSuggest;
  return (
    <div className={styles.picker}>
      <div className={fieldStyles.control}>
        <Search aria-hidden />
        <input
          ref={inputRef}
          id={field?.id}
          aria-describedby={field?.describedBy}
          aria-invalid={field?.invalid || undefined}
          aria-label={aria['aria-label']}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && options[active] ? `${listId}-${active}` : undefined}
          className={fieldStyles.bare}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={keyDown}
        />
        {results.isFetching && enabled && debounce > 0 && <Spinner label="Searching" />}
      </div>
      {showList && (
        <div className={styles.list} id={listId} role="listbox" aria-label="Results">
          {options.map((o, i) => (
            <div
              key={o.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              data-active={i === active || undefined}
              className={styles.option}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o)}
            >
              {o.imageUrl !== undefined && (
                <Avatar src={o.imageUrl} name={o.label} size={24} shape={o.shape ?? 'circle'} />
              )}
              <span className={styles.optionLabel}>{o.label}</span>
              {o.detail && <span className={styles.detail}>{o.detail}</span>}
            </div>
          ))}
          {enabled && results.isSuccess && !waiting && options.length === 0 && (
            <div className={styles.status}>{empty}</div>
          )}
          {(!enabled || waiting) && <div className={styles.status}>Searching…</div>}
          {results.isError && (
            <div className={styles.status} role="alert">
              {results.error instanceof Error ? results.error.message : 'Search failed. Try again.'}
            </div>
          )}
          {results.data?.note && <div className={styles.note}>{results.data.note}</div>}
        </div>
      )}
    </div>
  );
}
