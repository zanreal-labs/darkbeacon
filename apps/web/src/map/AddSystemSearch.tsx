'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { routes, type UniverseSystemDto } from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import { Search } from 'lucide-react';
import { api } from '../lib/api';
import { systemClass } from '../lib/universe';
import { Kbd } from '../ui';
import styles from './AddSystemSearch.module.css';

/**
 * A system on the map as the search finds it (Wanderer's top search): by its real name, its
 * custom and temporary names, its tag, its Labels and its Tags.
 */
export interface OnMapEntry {
  id: number;
  name: string;
  info: UniverseSystemDto | undefined;
  /** Other texts it is found by, each with what it is ("custom name", "label"...). */
  aliases: ReadonlyArray<{ text: string; what: string }>;
}

interface Props {
  /** Systems already on the map; picking one of them selects it instead of adding. */
  onMap: ReadonlySet<number>;
  onPick(system: UniverseSystemDto): void;
  /** The map's own systems, found by their other names, Labels and Tags. */
  entries?: readonly OnMapEntry[];
  /** Picking a system found on the map. */
  onFind?(solarSystemId: number): void;
  /** Off: the search only finds systems on the map (viewers). */
  canAdd?: boolean;
  /** Bumped to focus the input (e.g. "Add system here" from the menu). */
  focusToken?: number;
  placeholder?: string;
}

type Row =
  | { kind: 'map'; key: string; entry: OnMapEntry; match: string | null }
  | { kind: 'universe'; key: string; system: UniverseSystemDto };

/** On-map systems matching `text`, best first: name starts, then other names, then the rest. */
export function findOnMap(entries: readonly OnMapEntry[], text: string, limit = 6): Row[] {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const scored: Array<{ row: Row; score: number }> = [];
  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    const real = entry.info?.name.toLowerCase() ?? '';
    let score = -1;
    let match: string | null = null;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(q)) score = 2;
    else if (real && real !== name && (real.startsWith(q) || real.includes(q))) {
      score = real.startsWith(q) ? 1 : 3;
      match = `real name ${entry.info!.name}`;
    }
    for (const alias of entry.aliases) {
      const a = alias.text.toLowerCase();
      const s = a.startsWith(q) ? 1 : a.includes(q) ? 3 : -1;
      if (s >= 0 && (score < 0 || s < score)) {
        score = s;
        match = `${alias.what} ${alias.text}`;
      }
    }
    if (score >= 0) scored.push({ row: { kind: 'map', key: `m${entry.id}`, entry, match }, score });
  }
  return scored
    .sort(
      (a, b) =>
        a.score - b.score ||
        (a.row.kind === 'map' && b.row.kind === 'map' ? a.row.entry.name.localeCompare(b.row.entry.name) : 0),
    )
    .slice(0, limit)
    .map((s) => s.row);
}

export function AddSystemSearch({
  onMap,
  onPick,
  entries = [],
  onFind,
  canAdd = true,
  focusToken = 0,
  placeholder,
}: Props) {
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
    enabled: canAdd && query.length >= 2,
    staleTime: 5 * 60_000,
  });
  // On the map first (as typed, no wait), then the rest of the universe.
  const local = useMemo(() => findOnMap(entries, text), [entries, text]);
  const rows: Row[] = useMemo(() => {
    const found = new Set(local.map((r) => (r.kind === 'map' ? r.entry.id : 0)));
    const universe =
      canAdd && query.length >= 2
        ? (results.data ?? [])
            .filter((s) => !found.has(s.id))
            .map((system): Row => ({ kind: 'universe', key: `u${system.id}`, system }))
        : [];
    return [...local, ...universe];
  }, [local, results.data, query, canAdd]);
  const showList = text.trim().length >= (canAdd ? 2 : 1) || local.length > 0;

  const pick = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === 'map') {
      if (onFind) onFind(row.entry.id);
      else if (row.entry.info) onPick(row.entry.info);
    } else onPick(row.system);
    setText('');
    setActive(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (rows.length ? (a + step + rows.length) % rows.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(rows[active]);
    } else if (e.key === 'Escape') {
      setText('');
      inputRef.current?.blur();
    }
  };

  const searching = results.isFetching || query !== text.trim();
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
        aria-activedescendant={rows[active] ? `${listId}-${rows[active].key}` : undefined}
        aria-label={canAdd ? 'Search systems to add' : 'Find a system on the map'}
        placeholder={placeholder ?? (canAdd ? 'Find or add a system…' : 'Find a system…')}
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
          {rows.length === 0 && (
            <li className={styles.empty}>
              {canAdd && searching ? 'Searching…' : canAdd ? 'No system by that name.' : 'Not on this map.'}
            </li>
          )}
          {rows.map((row, i) => {
            const info = row.kind === 'map' ? row.entry.info : row.system;
            const cls = info ? systemClass(info) : null;
            const id = row.kind === 'map' ? row.entry.id : row.system.id;
            return (
              <li
                key={row.key}
                id={`${listId}-${row.key}`}
                role="option"
                aria-selected={i === active}
                className={styles.result}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => pick(row)}
                onPointerEnter={() => setActive(i)}
              >
                <span className={styles.class} style={cls ? { color: cssVar(cls.token) } : undefined}>
                  {cls?.label ?? ''}
                </span>
                <span className={styles.name}>{row.kind === 'map' ? row.entry.name : row.system.name}</span>
                <span className={styles.region}>
                  {row.kind === 'map' && row.match ? row.match : info?.regionName}
                </span>
                {onMap.has(id) && <span className={styles.onMap}>On map</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
