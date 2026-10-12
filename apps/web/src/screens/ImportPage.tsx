'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  CircleCheck,
  CircleX,
  Download,
  FileJson,
  Globe,
  Map as MapIcon,
  Merge,
  Plus,
  Upload,
} from 'lucide-react';
import type {
  ImportAccessEntryDto,
  ImportCountsDto,
  ImportJobDto,
  ImportOutcomeDto,
  ImportReportLineDto,
  MapRole,
  WandererApiSourceRequest,
} from '@darkbeacon/shared';
import { ApiError } from '../lib/api';
import {
  importReportUrl,
  useCancelImport,
  useImportJob,
  useImportPlan,
  useReadWanderer,
  useStartImport,
  useTestWanderer,
  useUploadExport,
} from '../lib/imports';
import { useMaps } from '../lib/maps';
import { atLeast } from '../lib/roles';
import { useMe } from '../lib/session';
import { track } from '../lib/telemetry';
import { useBreadcrumbs } from '../shell/breadcrumbs';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  ChoiceGroup,
  Field,
  Input,
  Page,
  PageHeader,
  Select,
  Skeleton,
  Stack,
  type Tone,
} from '../ui';
import { slugify } from './HomePage';
import styles from './ImportPage.module.css';

const TITLE = 'Import from Wanderer';
const DESCRIPTION =
  'Bring a whole Wanderer map over: systems, connections, signatures, structures, notes and access lists.';

/** The import screen while it loads. */
export function ImportPageSkeleton() {
  return (
    <Page width={880} aria-busy="true">
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <Skeleton width="100%" height={280} radius={10} />
    </Page>
  );
}

/**
 * `/import` (from All maps) and `/import?into=<slug>` (from a map's settings): choose a source,
 * test it, read the map into a preview, pick a new map or a map to merge into, then follow the
 * import as it runs and download its report.
 */
export function ImportPage({ into }: { into: string | null }) {
  useBreadcrumbs([{ label: 'All maps', to: '/maps' }, { label: TITLE }]);
  useEffect(() => track('page_viewed', { page: 'import' }), []);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useImportJob(jobId);
  const staged = job.data?.status === 'preview' ? job.data : null;
  const started = job.data && job.data.status !== 'preview' ? job.data : null;

  return (
    <Page width={880}>
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <Stack>
        {!started && <SourceCard onRead={setJobId} reading={jobId !== null && !job.data} />}
        {staged && <PreviewCard job={staged} />}
        {staged && <AccessCard entries={staged.access} />}
        {staged && <TargetCard job={staged} into={into} />}
        {started && <ProgressCard job={started} onAgain={() => setJobId(null)} />}
      </Stack>
    </Page>
  );
}

// ---- 1. Source ----------------------------------------------------------------------------------

function SourceCard({ onRead, reading }: { onRead(jobId: string): void; reading: boolean }) {
  const [kind, setKind] = useState<'api' | 'file'>('api');
  return (
    <Card aria-label="Source">
      <CardHeader
        title="Where is the map?"
        description="Over Wanderer's API brings everything and can keep syncing; an export file is read once."
      />
      <CardBody>
        <ChoiceGroup
          aria-label="Source"
          value={kind}
          onValueChange={(v) => setKind(v as 'api' | 'file')}
          options={[
            {
              value: 'api',
              label: "Wanderer's API",
              description: 'wanderer.ltd or your own Wanderer, with the map API key',
              icon: <Globe />,
            },
            {
              value: 'file',
              label: 'Export file',
              description: 'The .json file Wanderer exports',
              icon: <FileJson />,
            },
          ]}
        />
      </CardBody>
      {kind === 'api' ? <ApiSourceForm onRead={onRead} /> : <FileSourceForm onRead={onRead} />}
      {reading && <CardBody className="muted">Reading the map…</CardBody>}
    </Card>
  );
}

function ApiSourceForm({ onRead }: { onRead(jobId: string): void }) {
  const me = useMe();
  const admin = me.data?.account.instanceRole === 'owner' || me.data?.account.instanceRole === 'admin';
  const [baseUrl, setBaseUrl] = useState('https://wanderer.ltd');
  const [slug, setSlug] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [insecureTls, setInsecureTls] = useState(false);
  const test = useTestWanderer();
  const read = useReadWanderer();
  const source: WandererApiSourceRequest = {
    baseUrl: baseUrl.trim(),
    slug: slug.trim(),
    apiKey: apiKey.trim(),
    ...(insecureTls ? { insecureTls } : {}),
  };
  const ready = !!source.baseUrl && !!source.slug && !!source.apiKey;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    read.mutate(source, { onSuccess: (job) => onRead(job.id) });
  };
  const status = test.isPending
    ? 'Testing…'
    : test.data
      ? test.data.ok
        ? `Connected: ${test.data.systems} systems on ${test.data.host}`
        : test.data.message
      : test.error
        ? message(test.error)
        : null;
  return (
    <form onSubmit={submit} aria-label="Wanderer API">
      <CardBody>
        <div className={styles.fields}>
          <Field label="Wanderer address" hint="wanderer.ltd, or the address of your own Wanderer.">
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://wanderer.ltd"
            />
          </Field>
          <Field label="Map" hint="The map's slug, or paste its address from Wanderer.">
            <Input mono value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="home-chain" />
          </Field>
          <Field
            label="Map API key"
            hint="In Wanderer: the map's settings, Public API. Kept encrypted here, never shown again."
            error={read.error ? message(read.error) : undefined}
          >
            <Input
              type="password"
              autoComplete="off"
              mono
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Map API key"
            />
          </Field>
        </div>
        {admin && (
          <Checkbox
            className={styles.option}
            checked={insecureTls}
            onCheckedChange={setInsecureTls}
            label="Accept a self-signed certificate"
            description="Only for your own Wanderer whose certificate you trust; instance admins only."
          />
        )}
      </CardBody>
      <CardFooter>
        {status && (
          <span className={`${styles.status} muted`} role="status">
            {test.data?.ok ? (
              <CircleCheck className={styles.ok} />
            ) : test.data || test.error ? (
              <CircleX className={styles.bad} />
            ) : null}
            {status}
          </span>
        )}
        <Button
          type="button"
          disabled={!ready || read.isPending}
          loading={test.isPending}
          onClick={() => test.mutate(source)}
        >
          Test connection
        </Button>
        <Button type="submit" variant="primary" disabled={!ready} loading={read.isPending}>
          Read map
        </Button>
      </CardFooter>
    </form>
  );
}

function FileSourceForm({ onRead }: { onRead(jobId: string): void }) {
  const upload = useUploadExport();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  return (
    <form
      aria-label="Export file"
      onSubmit={(e) => {
        e.preventDefault();
        if (file) upload.mutate(file, { onSuccess: (job) => onRead(job.id) });
      }}
    >
      <CardBody>
        <Field
          label="Wanderer export"
          hint="The map's export from Wanderer (.json, up to 25 MB). Access lists only come over the API."
          error={upload.error ? message(upload.error) : undefined}
        >
          <input
            ref={input}
            className={styles.file}
            type="file"
            accept="application/json,.json"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
      </CardBody>
      <CardFooter>
        <Button type="submit" variant="primary" icon={<Upload />} disabled={!file} loading={upload.isPending}>
          Read file
        </Button>
      </CardFooter>
    </form>
  );
}

// ---- 2. Preview ---------------------------------------------------------------------------------

const COUNT_LABELS: Array<[keyof ImportCountsDto, string]> = [
  ['systems', 'Systems'],
  ['hiddenSystems', 'Hidden systems'],
  ['connections', 'Connections'],
  ['signatures', 'Signatures'],
  ['structures', 'Structures'],
  ['comments', 'Comments'],
  ['labels', 'Labels'],
  ['accessRules', 'Access rules'],
  ['hubs', 'Hubs'],
];

const BUCKETS: Array<{ bucket: ImportReportLineDto['bucket']; title: string; tone: Tone }> = [
  { bucket: 'mapped', title: 'Comes over as it is', tone: 'success' },
  { bucket: 'approximated', title: 'Comes over close to it', tone: 'warning' },
  { bucket: 'dropped', title: 'Left out', tone: 'danger' },
];

function PreviewCard({ job }: { job: ImportJobDto }) {
  return (
    <Card aria-label="Preview">
      <CardHeader
        title={job.source.name ?? job.source.slug}
        description={
          job.source.kind === 'wanderer-api'
            ? `Read from ${job.source.host} just now. Nothing is written until you import.`
            : 'Read from the export file. Nothing is written until you import.'
        }
      />
      <CardBody>
        <dl className={styles.counts}>
          {COUNT_LABELS.map(([key, label]) => (
            <div key={key} className={styles.count}>
              <dt>{label}</dt>
              <dd>{job.counts[key]}</dd>
            </div>
          ))}
        </dl>
        <Report lines={job.report} />
      </CardBody>
    </Card>
  );
}

function Report({ lines }: { lines: ImportReportLineDto[] }) {
  return (
    <div className={styles.report}>
      {BUCKETS.map(({ bucket, title, tone }) => {
        const mine = lines.filter((l) => l.bucket === bucket);
        if (mine.length === 0) return null;
        const total = mine.reduce((sum, l) => sum + l.count, 0);
        return (
          <details key={bucket} className={styles.bucket} open={bucket !== 'mapped'}>
            <summary>
              <Badge tone={tone}>{title}</Badge>
              <span className="muted">{total}</span>
            </summary>
            <ul>
              {mine.map((l) => (
                <li key={`${l.kind}${l.what}${l.why}`}>
                  <span className={styles.lineWhat}>
                    <span className={styles.lineCount}>{l.count}×</span> {l.what}
                  </span>
                  {l.why && <span className="muted"> — {l.why}</span>}
                  {l.examples.length > 0 && <span className={styles.examples}>{l.examples.join(', ')}</span>}
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

// ---- Access -------------------------------------------------------------------------------------

const ROLE_TONE: Record<MapRole, Tone> = {
  admin: 'accent',
  manager: 'accent',
  member: 'neutral',
  viewer: 'neutral',
  blocked: 'danger',
};
const ROLE_NAME: Record<MapRole, string> = {
  admin: 'Admin',
  manager: 'Manager',
  member: 'Member',
  viewer: 'Viewer',
  blocked: 'Blocked',
};
const KIND_NAME = { character: 'Character', corporation: 'Corporation', alliance: 'Alliance' } as const;
const IMAGE = 'https://images.evetech.net';

function AccessCard({ entries }: { entries: ImportAccessEntryDto[] }) {
  if (entries.length === 0) return null;
  return (
    <Card aria-label="Access">
      <CardHeader
        title="Who gets access"
        description="Wanderer ACL members become access rules on the map, by character, corporation and alliance. Nobody becomes an instance admin."
      />
      <CardBody flush>
        <ul className={styles.access}>
          {entries.map((entry) => {
            const image =
              entry.subjectKind === 'character'
                ? `${IMAGE}/characters/${entry.subjectId}/portrait?size=64`
                : `${IMAGE}/${entry.subjectKind === 'corporation' ? 'corporations' : 'alliances'}/${entry.subjectId}/logo?size=64`;
            const name = entry.esiName ?? entry.wandererName ?? `A ${entry.subjectKind} ESI does not know`;
            return (
              <li key={`${entry.subjectKind}:${entry.subjectId}`} className={styles.accessRow}>
                <Avatar
                  src={image}
                  name={name}
                  size={32}
                  shape={entry.subjectKind === 'character' ? 'circle' : 'rounded'}
                />
                <span className={styles.accessMain}>
                  <span className={styles.accessName}>
                    {name}
                    {entry.ticker && <span className="muted"> [{entry.ticker}]</span>}
                  </span>
                  <span className={`${styles.accessMeta} muted`}>
                    {KIND_NAME[entry.subjectKind]}
                    {entry.esiName ? ' · name from ESI' : entry.wandererName ? ' · name from Wanderer' : ''}
                    {` · ${entry.acls.join(', ')}`}
                    {entry.note && ` · ${entry.note}`}
                  </span>
                </span>
                <Badge tone={ROLE_TONE[entry.role]}>{ROLE_NAME[entry.role]}</Badge>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

// ---- 3. Target ----------------------------------------------------------------------------------

const KINDS: Array<[string, string]> = [
  ['systems', 'Systems'],
  ['connections', 'Connections'],
  ['signatures', 'Signatures'],
  ['labels', 'Labels'],
  ['access', 'Access rules'],
  ['settings', 'Settings'],
];

function TargetCard({ job, into }: { job: ImportJobDto; into: string | null }) {
  const maps = useMaps();
  const managed = useMemo(
    () => (maps.data ?? []).filter((m) => m.kind !== 'composite' && atLeast(m.role, 'manager')),
    [maps.data],
  );
  const preset = into ? managed.find((m) => m.slug === into) : undefined;
  const [mode, setMode] = useState<'new' | 'merge'>(preset ? 'merge' : 'new');
  const [mapId, setMapId] = useState<string | undefined>(preset?.id);
  const fallbackName = job.mapName ?? job.source.name ?? job.source.slug;
  const [name, setName] = useState(fallbackName);
  const [slug, setSlug] = useState<string | null>(null);
  const [includeAccess, setIncludeAccess] = useState(true);
  const [removeMissing, setRemoveMissing] = useState(false);
  const [keepSyncing, setKeepSyncing] = useState(false);
  const [interval, setInterval_] = useState('15');
  const plan = useImportPlan(job.id, mode === 'new' ? { mode } : mapId ? { mode, mapId } : null);
  const start = useStartImport(job.id);
  const cancel = useCancelImport(job.id);
  const api = job.source.kind === 'wanderer-api';
  const shownSlug = slug ?? slugify(name);
  const target = managed.find((m) => m.id === mapId);
  const canAccess = mode === 'new' || atLeast(target?.role, 'admin');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    start.mutate({
      mode,
      includeAccess: includeAccess && canAccess,
      removeMissing: mode === 'merge' && removeMissing,
      ...(mode === 'merge'
        ? { mapId }
        : // Without an address of their own, the server picks a free one from the name.
          { name: name.trim(), ...(slug !== null && shownSlug.length >= 2 ? { slug: shownSlug } : {}) }),
      ...(api && keepSyncing ? { keepSyncing: { intervalMinutes: Number(interval), removeMissing } } : {}),
    });
  };

  return (
    <Card aria-label="Import into">
      <CardHeader
        title="Import into"
        description="A new map, or merged into one you manage. A merge never deletes anything unless you ask."
      />
      <form onSubmit={submit}>
        <CardBody>
          <ChoiceGroup
            aria-label="Import into"
            value={mode}
            onValueChange={(v) => setMode(v as 'new' | 'merge')}
            options={[
              { value: 'new', label: 'A new map', description: 'You become its owner', icon: <Plus /> },
              {
                value: 'merge',
                label: 'A map I manage',
                description: managed.length > 0 ? 'Field by field, newer wins' : 'You manage no map yet',
                icon: <Merge />,
                disabled: managed.length === 0,
              },
            ]}
          />
          <div className={styles.target}>
            {mode === 'new' ? (
              <div className={styles.fields}>
                <Field label="Name">
                  <Input required maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Address" hint="Letters, numbers and dashes; a taken address gets a number.">
                  <Input
                    mono
                    maxLength={48}
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    icon={<span className={`${styles.prefix} mono`}>/m/</span>}
                    value={shownSlug}
                    onChange={(e) => setSlug(e.target.value)}
                  />
                </Field>
              </div>
            ) : (
              <Field label="Map">
                <Select
                  value={mapId}
                  onValueChange={setMapId}
                  placeholder="Choose a map"
                  options={managed.map((m) => ({ value: m.id, label: m.name, icon: <MapIcon /> }))}
                />
              </Field>
            )}
          </div>
          <PlanSummary plan={plan.data} pending={plan.isFetching} error={plan.error} />
          <div className={styles.options}>
            <Checkbox
              checked={includeAccess && canAccess}
              disabled={!canAccess || job.access.length === 0}
              onCheckedChange={setIncludeAccess}
              label="Import access rules"
              description={
                job.access.length === 0
                  ? 'This source has no ACL members.'
                  : canAccess
                    ? `${job.access.length} rules from Wanderer's ACLs. Rules the map has already stay as they are.`
                    : 'Only a map admin can change who has access.'
              }
            />
            {mode === 'merge' && (
              <Checkbox
                checked={removeMissing}
                onCheckedChange={setRemoveMissing}
                label="Remove what Wanderer no longer has"
                description="Only what an earlier import brought and nobody changed here since."
              />
            )}
            {api && (
              <Checkbox
                checked={keepSyncing}
                onCheckedChange={setKeepSyncing}
                label="Keep syncing from Wanderer"
                description="While you move over: pull changes from Wanderer every few minutes until you stop it in the map's settings."
              />
            )}
            {api && keepSyncing && (
              <Field label="Every">
                <Select
                  value={interval}
                  onValueChange={setInterval_}
                  options={['5', '10', '15', '30', '60'].map((m) => ({ value: m, label: `${m} minutes` }))}
                />
              </Field>
            )}
          </div>
          {start.error && (
            <Callout tone="danger" role="alert">
              {message(start.error)}
            </Callout>
          )}
        </CardBody>
        <CardFooter>
          <Button type="button" variant="ghost" onClick={() => cancel.mutate()} loading={cancel.isPending}>
            Discard
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={start.isPending}
            disabled={(mode === 'merge' && !mapId) || (mode === 'new' && !name.trim())}
          >
            Import
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function PlanSummary({
  plan,
  pending,
  error,
}: {
  plan: ReturnType<typeof useImportPlan>['data'];
  pending: boolean;
  error: unknown;
}) {
  if (error) return <Callout tone="danger">{message(error)}</Callout>;
  if (!plan) return pending ? <Skeleton width="100%" height={120} /> : null;
  return (
    <div className={styles.plan} aria-label="What the import does">
      <OutcomeTable outcome={plan.outcome} />
      {plan.accessBlocked && <Callout tone="warning">{plan.accessBlocked}</Callout>}
      {plan.conflicts.length > 0 && (
        <details className={styles.bucket}>
          <summary>
            <Badge tone="warning">Different on both sides</Badge>
            <span className="muted">{plan.conflicts.length + plan.moreConflicts}</span>
          </summary>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>What</th>
                <th>Field</th>
                <th>Here</th>
                <th>Wanderer</th>
                <th>Kept</th>
              </tr>
            </thead>
            <tbody>
              {plan.conflicts.map((c, i) => (
                <tr key={i} title={c.why}>
                  <td>{c.name}</td>
                  <td>{c.field}</td>
                  <td>{c.here}</td>
                  <td>{c.wanderer}</td>
                  <td>{c.keeps === 'here' ? 'Here' : 'Wanderer'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {plan.moreConflicts > 0 && <p className="muted">And {plan.moreConflicts} more.</p>}
        </details>
      )}
    </div>
  );
}

function OutcomeTable({ outcome }: { outcome: Record<string, ImportOutcomeDto> }) {
  const rows = KINDS.filter(([key]) => {
    const o = outcome[key];
    return o && o.created + o.updated + o.unchanged + o.skipped + o.removed > 0;
  });
  if (rows.length === 0) return null;
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th />
          <th>New</th>
          <th>Updated</th>
          <th>Unchanged</th>
          <th>Skipped</th>
          <th>Removed</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([key, label]) => {
          const o = outcome[key]!;
          return (
            <tr key={key}>
              <th scope="row">{label}</th>
              <td>{o.created}</td>
              <td>{o.updated}</td>
              <td>{o.unchanged}</td>
              <td>{o.skipped}</td>
              <td>{o.removed}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---- 4. Progress --------------------------------------------------------------------------------

const PHASES: Record<string, string> = {
  queued: 'Waiting to start',
  map: 'Preparing the map',
  labels: 'Labels',
  systems: 'Systems',
  connections: 'Connections',
  signatures: 'Signatures',
  access: 'Access rules',
  settings: 'Settings',
  removals: 'Removing what Wanderer removed',
  done: 'Done',
};

const STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Importing', tone: 'accent' },
  done: { label: 'Imported', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

function ProgressCard({ job, onAgain }: { job: ImportJobDto; onAgain(): void }) {
  const cancel = useCancelImport(job.id);
  const running = job.status === 'queued' || job.status === 'running';
  const percent = job.total > 0 ? Math.round((job.done / job.total) * 100) : running ? 0 : 100;
  const status = STATUS[job.status] ?? STATUS.queued!;
  let action: ReactNode = null;
  if (job.status === 'done' && job.mapSlug)
    action = (
      <Button asChild variant="primary" trailingIcon={<ArrowUpRight />}>
        <Link href={`/m/${job.mapSlug}`}>Open map</Link>
      </Button>
    );
  return (
    <Card aria-label="Import progress">
      <CardHeader
        title={job.mapName ?? 'Import'}
        description={`From ${job.source.kind === 'wanderer-api' ? `${job.source.host}/${job.source.slug}` : 'an export file'}`}
        actions={<Badge tone={status.tone}>{status.label}</Badge>}
      />
      <CardBody>
        <div
          className={styles.progress}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Import progress"
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        <p className={`${styles.phase} muted`}>
          {running
            ? `${PHASES[job.phase] ?? job.phase} · ${job.done} of ${job.total}`
            : (PHASES[job.phase] ?? job.phase)}
        </p>
        {job.error && (
          <Callout tone="danger" role="alert" title="The import stopped">
            {job.error}
          </Callout>
        )}
        {!running && <OutcomeTable outcome={job.outcome} />}
        {job.syncId && job.status === 'done' && (
          <Callout tone="accent" title="Syncing from Wanderer">
            Changes in Wanderer are pulled into this map every few minutes. Stop it in the map&apos;s
            settings, under Import.
          </Callout>
        )}
        {job.warnings.length > 0 && (
          <details className={styles.bucket}>
            <summary>
              <Badge tone="warning">Notes</Badge>
              <span className="muted">{job.warnings.length}</span>
            </summary>
            <ul>
              {job.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
        )}
      </CardBody>
      <CardFooter>
        {running ? (
          <Button variant="ghost" onClick={() => cancel.mutate()} loading={cancel.isPending}>
            Stop
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onAgain}>
              Import another
            </Button>
            <Button asChild icon={<Download />}>
              <a href={importReportUrl(job.id)} download>
                Download report
              </a>
            </Button>
          </>
        )}
        {action}
      </CardFooter>
    </Card>
  );
}

function message(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong';
}
