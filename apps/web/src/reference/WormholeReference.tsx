'use client';

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Search, X } from 'lucide-react';
import {
  HULL_CLASS_LABEL,
  WORMHOLE_DESTINATION_LABEL,
  WormholeDestination,
  type ShipSize,
  type WormholeRespawn,
} from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import {
  Button,
  Dialog,
  DialogClose,
  DialogDescription,
  DialogSheet,
  DialogTitle,
  EmptyState,
  IconButton,
  Input,
  Select,
  Skeleton,
  Switch,
} from '../ui';
import { SHIP_SIZE_LABEL, SHIP_SIZE_TEXT } from '../map/edgeStyle';
import { destinationPill } from '../map/nodeFacts';
import { useWormholeCatalog } from '../map/signatures/catalog';
import {
  areaLabel,
  DEFAULT_FILTER,
  DEFAULT_SORT,
  firstSort,
  filterRows,
  lifetimeText,
  nextSort,
  referenceRows,
  sizeLegend,
  sortRows,
  tonnes,
  type ReferenceFilter,
  type ReferenceRow,
  type ReferenceSort,
  type ReferenceSortKey,
} from './rows';
import styles from './reference.module.css';

const COLUMNS: readonly { key: ReferenceSortKey; label: string; title?: string; num?: boolean }[] = [
  { key: 'code', label: 'Type', title: 'Type and the class it leads to' },
  { key: 'spawns', label: 'Spawns in' },
  { key: 'lifetime', label: 'Lifetime', num: true },
  { key: 'totalMass', label: 'Total mass', num: true },
  { key: 'maxJumpMass', label: 'Max / jump', title: 'Heaviest ship that may jump', num: true },
  { key: 'size', label: 'Size', title: 'Ship size, from the max jump mass' },
  { key: 'respawn', label: 'Respawn' },
];

const SORT_LABEL: Record<ReferenceSortKey, string> = {
  code: 'Type',
  destination: 'Leads to',
  spawns: 'Spawns in',
  lifetime: 'Lifetime',
  totalMass: 'Total mass',
  maxJumpMass: 'Max per jump',
  size: 'Size',
  respawn: 'Respawn',
};

const RESPAWN_TEXT: Record<WormholeRespawn, string> = {
  static: 'A system’s static: a new one opens when it dies',
  wandering: 'Spawns at random',
  reverse: 'Also seen as the exit side of a wandering hole from elsewhere',
};

/** A class as a pill in the colours of the map's nodes ("C5", "HS", "Thera"). */
export function ClassPill({ destination, label }: { destination: WormholeDestination; label?: string }) {
  const pill = destinationPill(destination);
  const background = pill.kind === 'class' ? cssVar(pill.token) : pill.background;
  return (
    <span
      className={styles.pill}
      style={{ background } as CSSProperties}
      data-filled
      data-destination={destination}
    >
      {label ?? WORMHOLE_DESTINATION_LABEL[destination]}
    </span>
  );
}

/** Where a type spawns: classes as pills; shattered systems and Jove space as their own. */
function AreaPill({ area }: { area: string }) {
  if ((WormholeDestination.options as readonly string[]).includes(area))
    return <ClassPill destination={area as WormholeDestination} />;
  const shattered = /^c\d-shattered$/.test(area);
  return (
    <span
      className={styles.pill}
      data-area={area}
      style={shattered ? { background: cssVar('pill-special') } : undefined}
      data-filled={shattered || undefined}
      title={
        shattered ? `Only shattered ${area.slice(0, 2).toUpperCase()} systems` : 'Jove observatory systems'
      }
    >
      {areaLabel(area)}
    </span>
  );
}

/** The ship size letter, as on the map's connections, with what fits through. */
function SizeMark({ size, title }: { size: ShipSize | null; title?: string }) {
  if (!size) return <span className={styles.muted}>—</span>;
  return (
    <span className={styles.size} data-size={size} title={title ?? SHIP_SIZE_TEXT[size]}>
      {SHIP_SIZE_LABEL[size]}
    </span>
  );
}

function fitsTitle(row: ReferenceRow): string | undefined {
  if (!row.size) return undefined;
  const hulls = row.fits.map((h) => HULL_CLASS_LABEL[h]).join(', ');
  return `${SHIP_SIZE_TEXT[row.size]}${hulls ? `\nFits: ${hulls}` : ''}`;
}

function TypeCell({ row }: { row: ReferenceRow }) {
  return (
    <span className={styles.type}>
      <span className={styles.code}>{row.code}</span>
      {row.destination ? (
        <ClassPill destination={row.destination} />
      ) : row.code === 'K162' ? (
        <span className={styles.muted}>exit side</span>
      ) : null}
    </span>
  );
}

function Row({ row }: { row: ReferenceRow }) {
  const k162 = row.code === 'K162';
  // One element per cell: on phones the cells become label / value lines of a card.
  return (
    <tr data-code={row.code}>
      <th scope="row" data-label="Type">
        <TypeCell row={row} />
      </th>
      <td data-label="Spawns in">
        <span className={styles.chips}>
          {k162 ? (
            <span className={styles.muted}>Any class: the exit side of another hole</span>
          ) : row.spawnsIn.length === 0 ? (
            // Newer types the EVE University tables (WORMHOLE_SPAWNS) do not list yet.
            <span className={styles.muted} title="Not in the EVE University wormhole type tables yet">
              not listed yet
            </span>
          ) : (
            row.spawnsIn.map((a) => <AreaPill key={a} area={a} />)
          )}
        </span>
      </td>
      <td data-label="Lifetime" className={styles.num}>
        <span>{lifetimeText(row.lifetimeHours)}</span>
      </td>
      <td data-label="Total mass" className={styles.num}>
        <span>
          {tonnes(row.totalMass)}
          {row.massRegeneration ? (
            <span className={styles.regen} title={`Regenerates ${tonnes(row.massRegeneration)} per cycle`}>
              regen
            </span>
          ) : null}
        </span>
      </td>
      <td data-label="Max / jump" className={styles.num}>
        <span>{tonnes(row.maxJumpMass)}</span>
      </td>
      <td data-label="Size">
        <span className={styles.sizeCell}>
          <SizeMark size={row.size} title={fitsTitle(row)} />
          {row.size && <span className={styles.muted}>{SHIP_SIZE_TEXT[row.size]}</span>}
        </span>
      </td>
      <td data-label="Respawn">
        <span className={styles.chips}>
          {row.respawn.map((r) => (
            <span key={r} className={styles.respawn} data-respawn={r} title={RESPAWN_TEXT[r]}>
              {r}
            </span>
          ))}
        </span>
      </td>
    </tr>
  );
}

function SortHeader({
  column,
  sort,
  onSort,
}: {
  column: (typeof COLUMNS)[number];
  sort: ReferenceSort;
  onSort(key: ReferenceSortKey): void;
}) {
  const active = sort.key === column.key;
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={column.num ? styles.num : undefined}
      title={column.title}
    >
      <button type="button" className={styles.sort} onClick={() => onSort(column.key)} data-active={active}>
        {column.label}
        <Icon aria-hidden />
      </button>
    </th>
  );
}

const CLASS_OPTIONS = [
  { value: 'all', label: 'Any class' },
  ...WormholeDestination.options.map((d) => ({ value: d, label: `To ${WORMHOLE_DESTINATION_LABEL[d]}` })),
];

const SORT_OPTIONS = (Object.keys(SORT_LABEL) as ReferenceSortKey[]).map((k) => ({
  value: k,
  label: SORT_LABEL[k],
}));

/** What each size letter lets through, from the catalog's hull classes. */
function SizeLegend({ legend }: { legend: ReturnType<typeof sizeLegend> }) {
  if (legend.length === 0) return null;
  return (
    <dl className={styles.legend} aria-label="Ship sizes">
      {legend.map((entry, i) => (
        <div key={entry.size} className={styles.legendItem}>
          <dt>
            <SizeMark size={entry.size} />
          </dt>
          <dd>
            <span>
              {i === 0 ? '' : 'up to '}
              {entry.adds.map((h) => HULL_CLASS_LABEL[h]).join(', ') || '—'}
            </span>
            <span className={`${styles.muted} ${styles.legendMass}`}>
              ≤ {tonnes(entry.maxJumpMass)} per jump
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Wanderer's "Wormholes Reference": every wormhole type with the class it leads to, where it
 * spawns, lifetime, total and per-jump mass, the ship size that follows from the jump mass, and
 * how it respawns. Search by code, class or destination; filter by the class it leads to and to
 * statics; sort by any column. A dialog on wide screens, a full-height sheet of cards on phones.
 */
export function WormholeReference({
  open,
  onOpenChange,
  initialQuery = '',
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The search it opens with (a type code from a signature or connection). */
  initialQuery?: string;
}) {
  const catalog = useWormholeCatalog();
  const [filter, setFilter] = useState<ReferenceFilter>({
    query: initialQuery,
    destination: 'all',
    staticsOnly: false,
  });
  const [sort, setSort] = useState<ReferenceSort>(DEFAULT_SORT);
  const types = catalog.data?.types;
  const all = useMemo(() => referenceRows(types ?? []), [types]);
  const legend = useMemo(() => sizeLegend(types ?? []), [types]);
  const rows = useMemo(() => sortRows(filterRows(all, filter), sort), [all, filter, sort]);
  const patch = (next: Partial<ReferenceFilter>) => setFilter((f) => ({ ...f, ...next }));
  const filtered = filter.query.trim() !== '' || filter.destination !== 'all' || filter.staticsOnly;

  let body: ReactNode;
  if (catalog.isPending) {
    body = (
      <div className={styles.loading}>
        <Skeleton height={14} width="60%" />
        <Skeleton height={14} width="45%" />
      </div>
    );
  } else if (catalog.isError) {
    body = <EmptyState title="The wormhole types did not load" description="Try again in a moment." />;
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        title="No wormhole type matches"
        description="Search by type code (U210), class (C5, HS, Thera) or respawn (static)."
        actions={
          <Button variant="secondary" size="sm" onClick={() => setFilter(DEFAULT_FILTER)}>
            Clear filters
          </Button>
        }
      />
    );
  } else {
    body = (
      <table className={styles.table}>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <SortHeader key={c.key} column={c} sort={sort} onSort={(key) => setSort(nextSort(sort, key))} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={row.code} row={row} />
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogSheet width={1120} height={780} className={styles.sheet} data-wormhole-reference>
        <header className={styles.header}>
          <div className={styles.heading}>
            <DialogTitle className={styles.title}>Wormhole types</DialogTitle>
            <DialogDescription className={styles.description}>
              Every wormhole type: where it leads and spawns, how long it lives, how much mass it takes and
              which ships fit.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <IconButton label="Close" icon={<X />} size="sm" tooltip={false} />
          </DialogClose>
        </header>
        <div className={styles.toolbar}>
          <Input
            className={styles.search}
            aria-label="Search wormhole types"
            placeholder="Search: U210, C5, HS, static…"
            icon={<Search />}
            value={filter.query}
            onChange={(e) => patch({ query: e.target.value })}
            autoFocus={!initialQuery}
            trailing={
              filter.query ? (
                <IconButton
                  label="Clear search"
                  icon={<X />}
                  size="sm"
                  variant="ghost"
                  tooltip={false}
                  onClick={() => patch({ query: '' })}
                />
              ) : undefined
            }
          />
          <Select
            aria-label="Leads to"
            size="sm"
            className={styles.classSelect}
            value={filter.destination}
            onValueChange={(v) => patch({ destination: v as ReferenceFilter['destination'] })}
            options={CLASS_OPTIONS}
          />
          <Switch
            className={styles.statics}
            checked={filter.staticsOnly}
            onCheckedChange={(staticsOnly) => patch({ staticsOnly })}
            label="Statics only"
          />
          <Select
            aria-label="Sort by"
            size="sm"
            className={styles.phoneSort}
            value={sort.key}
            onValueChange={(v) => setSort(firstSort(v as ReferenceSortKey))}
            options={SORT_OPTIONS}
          />
          <span className={styles.count} aria-live="polite">
            {catalog.data ? `${rows.length}${filtered ? ` of ${all.length}` : ''} types` : ''}
          </span>
        </div>
        <SizeLegend legend={legend} />
        <div className={styles.scroll} data-reference-scroll>
          {body}
        </div>
        <p className={styles.source}>
          Lifetime, masses and where each type leads come from CCP&apos;s Static Data Export; spawns and
          respawn from the EVE University wormhole type tables. Total mass varies by ±10 % per hole.
        </p>
      </DialogSheet>
    </Dialog>
  );
}
