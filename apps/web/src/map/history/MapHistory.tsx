'use client';

import { useMemo, useState } from 'react';
import type { AuditEntryDto, MapDto } from '@darkbeacon/shared';
import { Download, History, RotateCcw } from 'lucide-react';
import { ApiError } from '../../lib/api';
import type { AuditNames } from '../../lib/audit';
import {
  entriesOf,
  historyExportUrl,
  useMapHistory,
  useRevertChange,
  type HistoryFilters,
} from '../../lib/history';
import type { MapPermissions } from '../../lib/roles';
import { useMe } from '../../lib/session';
import { useUniverseSystems } from '../../lib/universe';
import { groupByDay, EntryRow } from '../../screens/AuditTab';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  EmptyState,
  ErrorState,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Select,
  SkeletonRows,
  useToast,
} from '../../ui';
import auditStyles from '../../screens/audit.module.css';
import settingsStyles from '../../screens/settings.module.css';
import styles from './history.module.css';

const HOUR = 3_600_000;

/** Wanderer's periods, 1 hour to 3 months, and everything kept. */
export const PERIODS = [
  { value: '1h', label: 'Last hour', ms: HOUR },
  { value: '6h', label: 'Last 6 hours', ms: 6 * HOUR },
  { value: '12h', label: 'Last 12 hours', ms: 12 * HOUR },
  { value: '24h', label: 'Last day', ms: 24 * HOUR },
  { value: '7d', label: 'Last week', ms: 7 * 24 * HOUR },
  { value: '30d', label: 'Last month', ms: 30 * 24 * HOUR },
  { value: '90d', label: 'Last 3 months', ms: 90 * 24 * HOUR },
  { value: 'all', label: 'Everything kept', ms: null },
] as const;

/** Kinds of change, as the map's history filters them. */
export const MAP_HISTORY_KINDS = [
  { value: 'all', label: 'Every change', types: undefined },
  { value: 'systems', label: 'Systems', types: ['system.*'] },
  { value: 'connections', label: 'Connections', types: ['connection.*'] },
  { value: 'signatures', label: 'Signatures', types: ['signature.*', 'comment.*', 'structure.*'] },
  { value: 'labels', label: 'Labels and tags', types: ['labels.*', 'system_labels.*'] },
  { value: 'pings', label: 'Rally pings', types: ['ping.*'] },
  { value: 'characters', label: 'Characters', types: ['character.*'] },
  { value: 'settings', label: 'Settings, hubs and access', types: ['map.*', 'routes.*', 'access.*'] },
] as const;

/** `since` of a period, fixed when it is picked (a moving `since` would refetch forever). */
function sinceOf(period: string, now: number): number | undefined {
  const ms = PERIODS.find((p) => p.value === period)?.ms;
  return ms ? Math.floor((now - ms) / 60_000) * 60_000 : undefined;
}

/** Systems named in a page of history (the system itself, a ping's system). */
function systemIds(entries: readonly AuditEntryDto[]): number[] {
  const ids = new Set<number>();
  for (const e of entries) {
    if (e.entity?.kind === 'system') ids.add(Number(e.entity.id));
    const sys = (e.diff.solarSystemId?.after ?? e.removed?.solarSystemId) as unknown;
    if (typeof sys === 'number') ids.add(sys);
  }
  return [...ids].filter((id) => Number.isInteger(id) && id > 0);
}

/**
 * The map's history: every change, who made it and how, by period, kind of change and person;
 * members revert a change from here (refused when it changed again since). Viewers and up.
 */
export function MapHistory({ map, can }: { map: MapDto; can: MapPermissions }) {
  const toast = useToast();
  const me = useMe();
  const [period, setPeriod] = useState<string>('24h');
  const [since, setSince] = useState(() => sinceOf('24h', Date.now()));
  const [kind, setKind] = useState('all');
  const [person, setPerson] = useState('all');
  const myId = me.data?.account.id;
  const filters: HistoryFilters = {
    ...(since !== undefined ? { since } : {}),
    ...(kind !== 'all' ? { types: MAP_HISTORY_KINDS.find((k) => k.value === kind)?.types?.join(',') } : {}),
    ...(person === 'me' && myId
      ? { accountId: myId }
      : person !== 'all' && person !== 'me'
        ? { accountId: person }
        : {}),
  };
  const history = useMapHistory(map.id, filters);
  const revert = useRevertChange(map.id);
  const entries = entriesOf(history.data?.pages);
  const ids = useMemo(() => systemIds(entries), [entries]);
  const universe = useUniverseSystems(ids);
  const names: AuditNames = useMemo(
    () => ({
      system: (id) => universe.get(id)?.name,
      map: (id) => (id === map.id ? map.name : undefined),
      systemLabel: (_mapId, id) => map.systemLabels?.find((l) => l.id === id)?.name,
    }),
    [universe, map],
  );
  // People in the loaded history, to pick one.
  const people = new Map<string, string>();
  for (const e of entries)
    if (e.actor.accountId && e.actor.accountName) people.set(e.actor.accountId, e.actor.accountName);
  const filtered = kind !== 'all' || person !== 'all' || period !== 'all';
  const days = groupByDay(entries);

  const onRevert = (entry: AuditEntryDto) =>
    revert.mutate(entry.id, {
      onSuccess: () => toast({ title: 'Reverted', tone: 'success', duration: 2500 }),
      onError: (error) =>
        toast({
          title: 'Could not revert',
          description: error instanceof ApiError ? error.message : 'Network error',
          tone: 'danger',
        }),
    });

  return (
    <Card>
      <CardHeader
        title="History"
        icon={<History />}
        description="Every change on this map, newest first: who made it, with which character and how."
        actions={
          <Menu>
            <MenuTrigger asChild>
              <Button size="sm" icon={<Download />}>
                Export
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem href={historyExportUrl(map.id, filters, 'csv')}>Spreadsheet (CSV)</MenuItem>
              <MenuItem href={historyExportUrl(map.id, filters, 'json')}>Data (JSON)</MenuItem>
            </MenuContent>
          </Menu>
        }
      />
      <div className={auditStyles.filters}>
        <Select
          size="sm"
          aria-label="Period"
          value={period}
          onValueChange={(value) => {
            setPeriod(value);
            setSince(sinceOf(value, Date.now()));
          }}
          options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
        />
        <Select
          size="sm"
          aria-label="Kind of change"
          value={kind}
          onValueChange={setKind}
          options={MAP_HISTORY_KINDS.map((k) => ({ value: k.value, label: k.label }))}
        />
        <Select
          size="sm"
          aria-label="Person"
          value={person}
          onValueChange={setPerson}
          options={[
            { value: 'all', label: 'Everyone' },
            ...(myId ? [{ value: 'me', label: 'Me' }] : []),
            ...[...people]
              .filter(([id]) => id !== myId)
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([id, name]) => ({ value: id, label: name })),
          ]}
        />
      </div>
      <CardBody flush>
        {history.isPending ? (
          <SkeletonRows count={6} />
        ) : history.isError ? (
          <ErrorState compact error={history.error} onRetry={() => void history.refetch()} />
        ) : entries.length === 0 ? (
          <EmptyState
            compact
            icon={<History />}
            title={filtered ? 'Nothing matches these filters' : 'Nothing recorded yet'}
            description={
              filtered
                ? 'Try a longer period, another kind of change or everyone.'
                : 'Changes to the map show up here.'
            }
          />
        ) : (
          days.map((day) => (
            <section key={day.label} aria-label={day.label}>
              <h3 className={auditStyles.day}>{day.label}</h3>
              <ul className={settingsStyles.list}>
                {day.entries.map(({ entry, repeats }) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    repeats={repeats}
                    names={names}
                    actions={
                      entry.revertedBy ? (
                        <Badge variant="outline">Reverted</Badge>
                      ) : entry.revertible && can.edit && !entry.revertOf ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className={styles.revert}
                          icon={<RotateCcw />}
                          loading={revert.isPending && revert.variables === entry.id}
                          onClick={() => onRevert(entry)}
                        >
                          Revert
                        </Button>
                      ) : null
                    }
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </CardBody>
      {history.hasNextPage && (
        <CardFooter>
          <Button
            variant="ghost"
            loading={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            Show older
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
