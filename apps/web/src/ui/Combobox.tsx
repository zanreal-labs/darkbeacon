import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Spinner } from './Button';
import { cx } from './cx';
import { Input } from './Input';
import styles from './field.module.css';

export interface ComboboxProps<T> {
  /** Current text; the parent filters or fetches `items` from it. */
  query: string;
  onQueryChange(query: string): void;
  items: readonly T[];
  getKey(item: T): string | number;
  renderItem(item: T): ReactNode;
  onSelect(item: T): void;
  placeholder?: string;
  loading?: boolean;
  /** Shown when the query is not empty and nothing matched. */
  emptyText?: ReactNode;
  icon?: ReactNode;
  autoFocus?: boolean;
  size?: 'sm' | 'md';
  'aria-label': string;
  className?: string;
  /** Clear the text after a pick (default true). */
  clearOnSelect?: boolean;
}

/**
 * Search box with a suggestion list (ARIA 1.2 combobox): arrows move, Enter picks, Escape closes.
 * Filtering stays with the caller, so it works for local lists and server search alike.
 */
export function Combobox<T>({
  query,
  onQueryChange,
  items,
  getKey,
  renderItem,
  onSelect,
  placeholder,
  loading,
  emptyText = 'No matches',
  icon = <Search />,
  autoFocus,
  size,
  className,
  clearOnSelect = true,
  ...aria
}: ComboboxProps<T>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [rawActive, setActive] = useState(0);
  // New results keep the highlight in range; typing resets it to the first result.
  const active = Math.max(0, Math.min(rawActive, items.length - 1));
  const root = useRef<HTMLDivElement>(null);
  const showList = open && query.trim().length > 0;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const pick = (item: T) => {
    onSelect(item);
    if (clearOnSelect) onQueryChange('');
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive(items.length ? (active + 1) % items.length : 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(items.length ? (active - 1 + items.length) % items.length : 0);
    } else if (e.key === 'Enter' && showList && items[active] !== undefined) {
      e.preventDefault();
      pick(items[active]!);
    } else if (e.key === 'Escape') {
      if (showList) e.stopPropagation();
      setOpen(false);
    }
  };

  const optionId = (i: number) => `${id}-o${i}`;
  return (
    <div ref={root} className={cx(styles.combobox, className)}>
      <Input
        role="combobox"
        aria-label={aria['aria-label']}
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={showList && items.length ? optionId(active) : undefined}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={query}
        size={size}
        icon={icon}
        trailing={loading ? <Spinner /> : undefined}
        onChange={(e) => {
          onQueryChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul id={`${id}-list`} role="listbox" className={styles.listbox} aria-label={aria['aria-label']}>
          {items.map((item, i) => (
            <li
              key={getKey(item)}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className={styles.option}
              onPointerEnter={() => setActive(i)}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(item)}
            >
              {renderItem(item)}
            </li>
          ))}
          {!loading && items.length === 0 && <li className={styles.listboxEmpty}>{emptyText}</li>}
        </ul>
      )}
    </div>
  );
}
