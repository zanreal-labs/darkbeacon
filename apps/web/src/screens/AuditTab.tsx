'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Download,
  Globe,
  KeyRound,
  LogIn,
  Puzzle,
  Settings2,
  ShieldCheck,
  ShieldAlert,
  Users,
} from 'lucide-react';
import {
  buildPath,
  routes,
  type AdminAccountDto,
  type AuditEntryDto,
  type AuditVerifyDto,
  type InstanceSettingsDto,
  type MapDto,
  type MapSummaryDto,
  type ThemesDto,
} from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import {
  INSTANCE_AUDIT_KINDS,
  RETENTION_CHOICES,
  readEntry,
  typesFor,
  type AuditCategory,
  type AuditNames,
} from '../lib/audit';
import { entriesOf, historyExportUrl, useInstanceAudit, type HistoryFilters } from '../lib/history';
import { mapsKey } from '../lib/session-keys';
import { relativeTime } from '../lib/time';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  characterPortraitUrl,
  EmptyState,
  ErrorState,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Select,
  SkeletonRows,
  Stack,
  useToast,
} from '../ui';
import styles from './audit.module.css';
import settingsStyles from './settings.module.css';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

const CATEGORY_ICONS: Record<AuditCategory, ReactNode> = {
  signIn: <LogIn />,
  access: <Users />,
  plugins: <Puzzle />,
  instance: <Settings2 />,
  map: <Globe />,
  intel: <Globe />,
  tracking: <Globe />,
};

/** The instance audit: what changed on this instance, who did it, from where; and how long it is kept. */
export function AuditTab({ settingsKey }: { settingsKey: readonly unknown[] }) {
  return (
    <Stack>
      <Activity />
      <Retention settingsKey={settingsKey} />
      <Integrity />
    </Stack>
  );
}

function useNames(): AuditNames {
  const accounts = useQuery({
    queryKey: ['admin-accounts'],
    queryFn: () => api<AdminAccountDto[]>(routes.admin.accounts.path),
  });
  const maps = useQuery({ queryKey: mapsKey, queryFn: () => api<MapSummaryDto[]>(routes.maps.list.path) });
  const themes = useQuery({
    queryKey: ['admin-themes'],
    queryFn: () => api<ThemesDto>(routes.themes.list.path),
  });
  // Each map's Labels, so a change of a system's labels reads "added label WH1".
  const details = useQueries({
    queries: (maps.data ?? []).map((m) => ({
      queryKey: ['admin-map-labels', m.id],
      queryFn: () => api<MapDto>(buildPath(routes.maps.get.path, { mapId: m.id })),
      staleTime: 60_000,
    })),
  });
  const labelData = details.map((d) => d.data);
  // A new array every render: keyed by the maps' update times instead.
  const labelsKey = labelData.map((m) => `${m?.id}:${m?.updatedAt}`).join();
  return useMemo(() => {
    const accountNames = new Map(accounts.data?.map((a) => [a.id, a.name]));
    const mapNames = new Map(maps.data?.map((m) => [m.id, m.name]));
    const themeNames = new Map(themes.data?.themes.map((t) => [t.id, t.name]));
    const labelNames = new Map(
      labelData.flatMap((m) => (m?.systemLabels ?? []).map((l) => [`${m!.id}|${l.id}`, l.name] as const)),
    );
    return {
      account: (id) => accountNames.get(id),
      map: (id) => mapNames.get(id),
      theme: (id) => (id === 'system' ? 'Follow the system' : themeNames.get(id)),
      systemLabel: (mapId, id) => labelNames.get(`${mapId}|${id}`),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- labelData follows labelsKey
  }, [accounts.data, maps.data, themes.data, labelsKey]);
}

function dayLabel(ms: number, now = Date.now()): string {
  const day = (t: number) => new Date(t).toDateString();
  if (day(ms) === day(now)) return 'Today';
  if (day(ms) === day(now - 86_400_000)) return 'Yesterday';
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Same person, same kind of activity, one after the other (demo sign-ins, reconnects). */
function sameActivity(a: AuditEntryDto, b: AuditEntryDto): boolean {
  return (
    a.type.startsWith('auth.') &&
    a.type === b.type &&
    a.actor.accountId === b.actor.accountId &&
    JSON.stringify(a.diff) === JSON.stringify(b.diff)
  );
}

/** Entries by day, repeated sign-ins folded into the newest one. */
export function groupByDay(entries: readonly AuditEntryDto[]) {
  const days: Array<{ label: string; entries: Array<{ entry: AuditEntryDto; repeats: number }> }> = [];
  for (const entry of entries) {
    const label = dayLabel(entry.occurredAt);
    if (days.at(-1)?.label !== label) days.push({ label, entries: [] });
    const rows = days.at(-1)!.entries;
    const last = rows.at(-1);
    if (last && sameActivity(last.entry, entry)) last.repeats += 1;
    else rows.push({ entry, repeats: 1 });
  }
  return days;
}

function Activity() {
  const [person, setPerson] = useState('all');
  const [kind, setKind] = useState('all');
  const filters: HistoryFilters = {
    ...(person !== 'all' ? { accountId: person } : {}),
    ...(typesFor(kind) ? { types: typesFor(kind) } : {}),
  };
  const audit = useInstanceAudit(filters);
  const names = useNames();
  const accounts = useQuery({
    queryKey: ['admin-accounts'],
    queryFn: () => api<AdminAccountDto[]>(routes.admin.accounts.path),
  });
  // Access re-checks follow sign-outs and character changes; in the full feed they are noise.
  const entries = entriesOf(audit.data?.pages).filter(
    (e) => kind !== 'all' || e.type !== 'access.account_changed',
  );
  const filtered = person !== 'all' || kind !== 'all';
  const days = groupByDay(entries);

  return (
    <Card>
      <CardHeader
        title="Activity"
        description="Sign-ins, roles, access rules, plugins, themes, settings and webhooks, newest first. Changes on a map are in that map's history."
        actions={
          <Menu>
            <MenuTrigger asChild>
              <Button size="sm" icon={<Download />}>
                Export
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem href={historyExportUrl(null, filters, 'csv')}>Spreadsheet (CSV)</MenuItem>
              <MenuItem href={historyExportUrl(null, filters, 'json')}>Data (JSON)</MenuItem>
            </MenuContent>
          </Menu>
        }
      />
      <div className={styles.filters}>
        <Select
          size="sm"
          aria-label="Person"
          value={person}
          onValueChange={setPerson}
          options={[
            { value: 'all', label: 'Everyone' },
            ...(accounts.data ?? []).map((a) => ({ value: a.id, label: a.name })),
          ]}
        />
        <Select
          size="sm"
          aria-label="Kind of change"
          value={kind}
          onValueChange={setKind}
          options={INSTANCE_AUDIT_KINDS.map((k) => ({ value: k.value, label: k.label }))}
        />
      </div>
      <CardBody flush>
        {audit.isPending ? (
          <SkeletonRows count={5} />
        ) : audit.isError ? (
          <ErrorState compact error={audit.error} onRetry={() => void audit.refetch()} />
        ) : entries.length === 0 ? (
          <EmptyState
            compact
            icon={<ShieldCheck />}
            title={filtered ? 'Nothing matches these filters' : 'Nothing recorded yet'}
            description={
              filtered
                ? 'Pick someone else or another kind of change.'
                : 'Sign-ins and admin changes show up here.'
            }
          />
        ) : (
          days.map((day) => (
            <section key={day.label} aria-label={day.label}>
              <h3 className={styles.day}>{day.label}</h3>
              <ul className={settingsStyles.list}>
                {day.entries.map(({ entry, repeats }) => (
                  <EntryRow key={entry.id} entry={entry} repeats={repeats} names={names} />
                ))}
              </ul>
            </section>
          ))
        )}
      </CardBody>
      {audit.hasNextPage && (
        <CardFooter>
          <Button
            variant="ghost"
            loading={audit.isFetchingNextPage}
            onClick={() => void audit.fetchNextPage()}
          >
            Show older
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

/** One change, as a sentence with its field changes and where it came from; `actions` at the end. */
export function EntryRow({
  entry,
  repeats,
  names,
  actions,
}: {
  entry: AuditEntryDto;
  repeats: number;
  names: AuditNames;
  actions?: ReactNode;
}) {
  const reading = readEntry(entry, names);
  const when = (
    <time
      dateTime={new Date(entry.occurredAt).toISOString()}
      title={new Date(entry.occurredAt).toLocaleString()}
    >
      {relativeTime(entry.occurredAt)}
    </time>
  );
  const failed = entry.type === 'auth.sign_in_failed';
  const { characterId, characterName } = entry.actor;
  return (
    <li className={styles.entry} data-tone={failed ? 'danger' : undefined}>
      <span className={styles.icon} data-category={reading.category} aria-hidden>
        {failed ? <ShieldAlert /> : CATEGORY_ICONS[reading.category]}
      </span>
      <div className={styles.body}>
        <p className={styles.sentence}>
          <strong>{reading.who}</strong> {reading.what}
          {repeats > 1 && (
            <Badge variant="outline" className={styles.repeats}>
              {repeats} times
            </Badge>
          )}
        </p>
        {reading.changes.length > 0 && (
          <ul className={styles.changes} aria-label="Changes">
            {reading.changes.map((c) => (
              <li key={c.label} className={styles.change}>
                <span className={styles.field}>{c.label}</span>
                {c.after === '' ? (
                  <span>{c.before}</span>
                ) : c.before === '—' ? (
                  <span className={styles.after}>{c.after}</span>
                ) : (
                  <>
                    <span className={styles.before}>{c.before}</span>
                    <ArrowRight aria-label="to" className={styles.arrow} />
                    <span className={styles.after}>{c.after}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className={styles.meta}>
          <span className={styles.metaTime}>{when}</span>
          {characterName && (
            <span className={styles.character}>
              {characterId && (
                <Avatar src={characterPortraitUrl(characterId, 32)} name={characterName} size={16} />
              )}
              {characterName}
            </span>
          )}
          <span>{reading.via}</span>
          {entry.origin?.country && (
            <span title="Country, as reported by the proxy in front of this server">
              {entry.origin.country}
            </span>
          )}
          {entry.origin?.userAgent && (
            <span className={styles.agent} title={entry.origin.userAgent}>
              {browserOf(entry.origin.userAgent)}
            </span>
          )}
          {entry.revertOf && <Badge variant="outline">Revert</Badge>}
          {actions}
        </div>
      </div>
      <span className={styles.time}>{when}</span>
    </li>
  );
}

/** "Firefox on Windows" from a user agent; the full string is the tooltip. */
export function browserOf(agent: string): string {
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : /EVE|CCP/i.test(agent)
            ? 'EVE client'
            : null;
  const system = /Windows/.test(agent)
    ? 'Windows'
    : /Android/.test(agent)
      ? 'Android'
      : /iPhone|iPad/.test(agent)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(agent)
          ? 'macOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : null;
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? 'Other client';
}

function Retention({ settingsKey }: { settingsKey: readonly unknown[] }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const settings = useQuery({
    queryKey: settingsKey,
    queryFn: () => api<InstanceSettingsDto>(routes.admin.settings.path),
  });
  const save = useMutation({
    mutationFn: (eventRetentionDays: number | null) =>
      api<InstanceSettingsDto>(routes.admin.updateSettings.path, {
        method: 'PATCH',
        json: { eventRetentionDays },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(settingsKey, data);
      void queryClient.invalidateQueries({ queryKey: ['history'] });
      toast({ title: 'Saved', tone: 'success' });
    },
    onError: (error) =>
      toast({ title: 'Could not save', description: errorText(error, 'Try again.'), tone: 'danger' }),
  });
  const days = settings.data?.eventRetentionDays ?? null;
  const current =
    RETENTION_CHOICES.find((c) => c.days === days)?.value ?? (days === null ? 'forever' : String(days));
  const options =
    RETENTION_CHOICES.some((c) => c.value === current) || days === null
      ? RETENTION_CHOICES
      : [...RETENTION_CHOICES, { value: current, label: `${days} days`, days }];
  return (
    <Card>
      <CardHeader
        title="Keep history"
        description="How long changes are kept, here and in every map's history. Live updates and webhooks never need old changes."
      />
      <CardBody>
        <div className={styles.retention}>
          <Select
            aria-label="Keep history for"
            value={current}
            disabled={!settings.data || save.isPending}
            onValueChange={(value) => save.mutate(options.find((c) => c.value === value)?.days ?? null)}
            options={options.map((c) => ({ value: c.value, label: c.label }))}
          />
          <span className={settingsStyles.footerNote}>
            {days === null
              ? 'Nothing is deleted.'
              : `Changes older than ${days} days are deleted every hour.`}
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

function Integrity() {
  const names = useNames();
  const verify = useMutation({
    mutationFn: () => api<AuditVerifyDto>(routes.audit.verify.path, { method: 'POST' }),
  });
  const result = verify.data;
  const broken = result?.streams.filter((s) => !s.ok) ?? [];
  const checked = result?.streams.reduce((n, s) => n + s.checked, 0) ?? 0;
  const streamName = (stream: string) =>
    stream === 'instance'
      ? 'instance changes'
      : stream === 'audit:instance'
        ? 'sign-ins and admin changes'
        : stream.startsWith('map:')
          ? (names.map?.(stream.slice(4)) ?? 'a map you cannot open')
          : 'another history';
  return (
    <Card>
      <CardHeader
        title="Integrity"
        icon={<KeyRound />}
        description="Every change is chained to the one before it. A check recomputes the chain and finds edits made behind the server's back."
      />
      {result && (
        <CardBody>
          {broken.length === 0 ? (
            <Callout tone="success" role="status" title="Every history is intact">
              {checked.toLocaleString()} changes in {result.streams.length} histories checked{' '}
              {relativeTime(result.checkedAt)}.
            </Callout>
          ) : (
            <Callout tone="danger" role="alert" title="Some history was changed outside Darkbeacon">
              {broken.map((s) => (
                <span key={s.stream} className={styles.broken}>
                  {titleCase(streamName(s.stream))}: change {s.brokenAt?.seq ?? '?'} no longer matches.
                </span>
              ))}
            </Callout>
          )}
        </CardBody>
      )}
      {verify.isError && (
        <CardBody>
          <ErrorState compact error={verify.error} onRetry={() => verify.mutate()} />
        </CardBody>
      )}
      <CardFooter>
        <span className={settingsStyles.footerNote}>
          {result ? 'Run it again after restoring a backup.' : 'Takes a moment on a long history.'}
        </span>
        <Button icon={<ShieldCheck />} loading={verify.isPending} onClick={() => verify.mutate()}>
          {result ? 'Check again' : 'Check integrity'}
        </Button>
      </CardFooter>
    </Card>
  );
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
