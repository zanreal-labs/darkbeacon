'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { routes, type UniverseSystemDto } from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import { Search } from 'lucide-react';
import { api } from '../lib/api';
import { systemClass } from '../lib/universe';
import { Kbd } from '../ui';
import styles from './AddSystemSearch.module.css';

interface Props {
  /** Systems already on the map; picking one of them selects it instead of adding. */
  onMap: ReadonlySet<number>;
  onPick(system: UniverseSystemDto): void;
  /** Bumped to focus the input (e.g. "Add system here" from the menu). */
  focusToken?: number;
  placeholder?: string;
}

export function AddSystemSearch({ onMap, onPick, focusToken = 0, placeholder = 'Add a system…' }: Props) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 200);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    if (focusToken > 0) inputRef.current?.focus();
  }, [focusToken]);

  // `/` focuses the search from anywhere on the map, like most dense tools.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const results = useQuery({
    queryKey: ['universe-search', query],
    queryFn: () =>
      api<UniverseSystemDto[]>(
        `${routes.universe.searchSystems.path}?${new URLSearchParams({ q: query, limit: '8' })}`,
      ),
    enabled: query.length >= 2,
    staleTime: 5 * 60_000,
  });
  const items = query.length >= 2 ? (results.data ?? []) : [];
  const showList = text.trim().length >= 2;

  const pick = (system: UniverseSystemDto | undefined) => {
    if (!system) return;
    onPick(system);
    setText('');
    setActive(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (items.length ? (a + step + items.length) % items.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === 'Escape') {
      setText('');
      inputRef.current?.blur();
    }
  };

  return (
    <div className={styles.search}>
      <Search className={styles.icon} aria-hidden />
      <input
        ref={inputRef}
        className={styles.input}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={items[active] ? `${listId}-${items[active].id}` : undefined}
        aria-label="Search systems to add"
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      {!text && (
        <span className={styles.hint} aria-hidden>
          <Kbd>/</Kbd>
        </span>
      )}
      {showList && (
        <ul id={listId} role="listbox" className={styles.results}>
          {items.length === 0 && (
            <li className={styles.empty}>
              {results.isFetching || query !== text.trim() ? 'Searching…' : 'No system by that name.'}
            </li>
          )}
          {items.map((s, i) => {
            const cls = systemClass(s);
            return (
              <li
                key={s.id}
                id={`${listId}-${s.id}`}
                role="option"
                aria-selected={i === active}
                className={styles.result}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                onPointerEnter={() => setActive(i)}
              >
                <span className={styles.class} style={{ color: cssVar(cls.token) }}>
                  {cls.label}
                </span>
                <span className={styles.name}>{s.name}</span>
                <span className={styles.region}>{s.regionName}</span>
                {onMap.has(s.id) && <span className={styles.onMap}>On map</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
