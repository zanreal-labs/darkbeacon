'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowUpRight, DatabaseBackup, Download, Trash2, Upload } from 'lucide-react';
import {
  buildPath,
  RESTORE_CONFIRMATION,
  routes,
  type BackupDto,
  type BackupSettingsDto,
  type BackupStatusDto,
  type BackupTrigger,
  type RestoreResultDto,
  type UpdateBackupSettingsRequest,
} from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import { relativeTime } from '../lib/time';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Select,
  SkeletonRows,
  Stack,
  Switch,
  useToast,
} from '../ui';
import styles from './settings.module.css';
import own from './backups.module.css';

export const backupsKey = ['admin-backups'] as const;

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

const TRIGGERS: Record<BackupTrigger, { label: string; tone: 'neutral' | 'accent' | 'warning' }> = {
  manual: { label: 'Manual', tone: 'accent' },
  scheduled: { label: 'Scheduled', tone: 'neutral' },
  'pre-restore': { label: 'Before a restore', tone: 'warning' },
  'pre-migration': { label: 'Before an update', tone: 'warning' },
};

const INTERVALS = [
  { value: 'off', label: 'Off' },
  { value: '60', label: 'Every hour' },
  { value: '360', label: 'Every 6 hours' },
  { value: '720', label: 'Every 12 hours' },
  { value: '1440', label: 'Every day' },
  { value: '10080', label: 'Every week' },
];

const AGES = [
  { value: 'none', label: 'Never: keep by count only' },
  { value: '7', label: 'After 7 days' },
  { value: '30', label: 'After 30 days' },
  { value: '90', label: 'After 90 days' },
  { value: '365', label: 'After a year' },
];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** "in 5 h", "in 20 min", "within a minute". */
function untilText(ms: number, now = Date.now()): string {
  const minutes = Math.round((ms - now) / 60_000);
  if (minutes <= 1) return 'within a minute';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} days`;
}

function intervalLabel(minutes: number | null): string {
  if (minutes === null) return 'Off';
  return INTERVALS.find((o) => o.value === String(minutes))?.label ?? `Every ${minutes} minutes`;
}

export function useBackupStatus() {
  return useQuery({
    queryKey: backupsKey,
    queryFn: () => api<BackupStatusDto>(routes.backups.status.path),
    // Running backups and restores show up without a reload.
    refetchInterval: (query) => (query.state.data?.running ? 2_000 : 60_000),
  });
}

/** The Backups tab of the admin page. */
export function BackupsTab() {
  const status = useBackupStatus();
  if (status.isPending) {
    return (
      <Card>
        <CardHeader title="Backups" description="Copies of the database you can restore from." />
        <CardBody flush>
          <SkeletonRows count={3} avatar={false} />
        </CardBody>
      </Card>
    );
  }
  if (status.isError) {
    return (
      <Card>
        <CardHeader title="Backups" />
        <CardBody>
          <ErrorState compact error={status.error} onRetry={() => void status.refetch()} />
        </CardBody>
      </Card>
    );
  }
  if (!status.data.supported) return <PostgresBackups />;
  return (
    <Stack>
      <BackupList status={status.data} />
      <ScheduleSettings status={status.data} />
      <AlertSettings settings={status.data.settings} />
      <RestoreFromFile maxBytes={status.data.maxUploadBytes} />
    </Stack>
  );
}

function PostgresBackups() {
  return (
    <Card>
      <CardHeader title="Backups" description="This instance keeps its data in PostgreSQL." />
      <CardBody>
        <Callout tone="neutral" title="Back up PostgreSQL with its own tools">
          Built-in backups are for the SQLite database. Use <span className="mono">pg_dump</span> on a
          schedule and <span className="mono">psql</span> or <span className="mono">pg_restore</span> to
          restore; see docs/backups.md for the commands.
        </Callout>
      </CardBody>
      <CardFooter>
        <Button asChild trailingIcon={<ArrowUpRight />}>
          <a href="https://www.postgresql.org/docs/current/backup-dump.html" target="_blank" rel="noreferrer">
            PostgreSQL backup guide
          </a>
        </Button>
      </CardFooter>
    </Card>
  );
}

function BackupList({ status }: { status: BackupStatusDto }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [restoring, setRestoring] = useState<BackupDto | null>(null);
  const [removing, setRemoving] = useState<BackupDto | null>(null);
  const create = useMutation({
    mutationFn: () => api<BackupDto>(routes.backups.create.path, { method: 'POST' }),
    onSuccess: (backup) => {
      void queryClient.invalidateQueries({ queryKey: backupsKey });
      toast({ title: 'Backup made', description: formatBytes(backup.size), tone: 'success' });
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: backupsKey });
      toast({ title: 'Could not back up', description: errorText(error, 'Try again.'), tone: 'danger' });
    },
  });
  const remove = useMutation({
    mutationFn: (name: string) =>
      api<void>(buildPath(routes.backups.remove.path, { name }), { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: backupsKey }),
    onError: (error) =>
      toast({ title: 'Could not delete', description: errorText(error, 'Try again.'), tone: 'danger' }),
  });
  const restore = (backup: BackupDto) =>
    api<RestoreResultDto>(buildPath(routes.backups.restore.path, { name: backup.name }), {
      method: 'POST',
      json: { confirm: RESTORE_CONFIRMATION },
    });

  const failure = status.failing ? status.lastFailure : null;
  const running = status.running ?? (create.isPending ? { operation: 'backup' as const } : null);
  const last = status.lastSuccess;
  return (
    <Card>
      <CardHeader
        title="Backups"
        description={
          <>
            Copies of the database, kept in <span className="mono">{status.directory}</span>. Download one now
            and then to keep a copy off this server.
          </>
        }
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<DatabaseBackup />}
            loading={create.isPending}
            disabled={!!status.running}
            onClick={() => create.mutate()}
          >
            Back up now
          </Button>
        }
      />
      <CardBody className={own.summary}>
        {failure && (
          <Callout
            tone="danger"
            role="alert"
            title={`The last ${failure.operation === 'restore' ? 'restore' : failure.trigger === 'scheduled' ? 'scheduled backup' : 'backup'} failed ${relativeTime(failure.at)}`}
          >
            {failure.message}
          </Callout>
        )}
        {running && (
          <Callout
            tone="accent"
            role="status"
            title={running.operation === 'restore' ? 'Restoring…' : 'Backing up…'}
          >
            {running.operation === 'restore'
              ? 'Writes wait until the database is back.'
              : 'Darkbeacon keeps working while the copy is made.'}
          </Callout>
        )}
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>Last backup</dt>
            <dd title={last ? when(last.at) : undefined}>{last ? relativeTime(last.at) : 'None yet'}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Next backup</dt>
            <dd>{status.nextRunAt === null ? 'Not scheduled' : untilText(status.nextRunAt)}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Kept</dt>
            <dd>
              {status.backups.length === 1 ? '1 backup' : `${status.backups.length} backups`},{' '}
              {formatBytes(status.backups.reduce((sum, b) => sum + b.size, 0))}
            </dd>
          </div>
        </dl>
      </CardBody>
      <CardBody flush className={own.listBody}>
        {status.backups.length === 0 ? (
          <EmptyState
            compact
            icon={<Archive />}
            title="No backups yet"
            description={
              status.nextRunAt === null
                ? 'Nothing is scheduled. Back up now, or turn the schedule on below.'
                : `The first scheduled backup runs ${untilText(status.nextRunAt)}.`
            }
          />
        ) : (
          <ul className={styles.list} aria-label="Backups">
            {status.backups.map((b) => (
              <li key={b.name} className={`${styles.item} ${styles.itemCenter} ${own.row}`}>
                <span className={styles.subjectIcon} aria-hidden>
                  <Archive />
                </span>
                <div className={styles.rowBody}>
                  <div className={styles.rowTitle}>
                    {when(b.createdAt)}
                    <Badge tone={TRIGGERS[b.trigger].tone}>{TRIGGERS[b.trigger].label}</Badge>
                  </div>
                  <div className={styles.rowMeta}>
                    {formatBytes(b.size)} · version {b.appVersion} · {relativeTime(b.createdAt)}
                  </div>
                </div>
                <div className={`${styles.rowActions} ${own.actions}`}>
                  <IconButton
                    asChild
                    size="sm"
                    variant="secondary"
                    label={`Download ${when(b.createdAt)}`}
                    icon={<Download />}
                  >
                    <a href={buildPath(routes.backups.download.path, { name: b.name })} download={b.name} />
                  </IconButton>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={!!status.running}
                    onClick={() => setRestoring(b)}
                  >
                    Restore…
                  </Button>
                  <IconButton
                    size="sm"
                    label={`Delete ${when(b.createdAt)}`}
                    icon={<Trash2 />}
                    disabled={!!status.running}
                    onClick={() => setRemoving(b)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <RestoreDialog
        open={restoring !== null}
        onOpenChange={(open) => !open && setRestoring(null)}
        what={restoring ? `the backup of ${when(restoring.createdAt)}` : ''}
        restore={() => restore(restoring!)}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Delete this backup?"
        description={
          removing
            ? `The backup of ${when(removing.createdAt)} (${formatBytes(removing.size)}) is gone for good, unless you downloaded it.`
            : undefined
        }
        confirmLabel="Delete backup"
        tone="danger"
        onConfirm={() => removing && remove.mutateAsync(removing.name)}
      />
    </Card>
  );
}

/**
 * The typed confirmation every restore goes through. On success the page reloads: the whole
 * database changed under it (and the session may be one the backup does not know).
 */
function RestoreDialog({
  open,
  onOpenChange,
  what,
  restore,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  what: string;
  restore(): Promise<RestoreResultDto>;
}) {
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = typed.trim() === RESTORE_CONFIRMATION;
  const close = (next: boolean) => {
    if (busy) return;
    if (!next) {
      setTyped('');
      setError(null);
    }
    onOpenChange(next);
  };
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await restore();
      toast({
        title: 'Backup restored',
        description:
          result.migrationsApplied.length > 0
            ? `It was brought up to this version (${result.migrationsApplied.length} updates). Reloading…`
            : 'Reloading…',
        tone: 'success',
      });
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setBusy(false);
      setError(errorText(e, 'The restore failed. Nothing was changed.'));
    }
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        title="Restore this backup?"
        description={`The whole database is replaced with ${what}: maps, accounts and settings. Everything changed since then is lost, except in the backup made of it first.`}
        width={460}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button variant="danger" loading={busy} disabled={!confirmed} onClick={() => void run()}>
              Restore backup
            </Button>
          </>
        }
      >
        <div className={styles.formStack}>
          {busy ? (
            <Callout tone="accent" role="status" title="Restoring…">
              Darkbeacon is in maintenance until it is done: everyone is disconnected for a moment, and anyone
              who signed in after the backup signs in again.
            </Callout>
          ) : (
            error && (
              <Callout tone="danger" role="alert" title="Not restored">
                {error}
              </Callout>
            )
          )}
          <Field label={`Type ${RESTORE_CONFIRMATION} to confirm`}>
            <Input
              mono
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={typed}
              disabled={busy}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && confirmed && !busy) void run();
              }}
              placeholder={RESTORE_CONFIRMATION}
            />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleSettings({ status }: { status: BackupStatusDto }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const saved = status.settings;
  const [draft, setDraft] = useState<{ interval: string; keep: string; age: string } | null>(null);
  const value = draft ?? {
    interval: saved.intervalMinutes === null ? 'off' : String(saved.intervalMinutes),
    keep: String(saved.keep),
    age: saved.maxAgeDays === null ? 'none' : String(saved.maxAgeDays),
  };
  const intervals = INTERVALS.some((o) => o.value === value.interval)
    ? INTERVALS
    : [...INTERVALS, { value: value.interval, label: intervalLabel(Number(value.interval)) }];
  const ages = AGES.some((o) => o.value === value.age)
    ? AGES
    : [...AGES, { value: value.age, label: `After ${value.age} days` }];
  const keep = Number(value.keep);
  const keepValid = Number.isInteger(keep) && keep >= 1 && keep <= 1000;
  const save = useMutation({
    mutationFn: (body: UpdateBackupSettingsRequest) =>
      api<BackupSettingsDto>(routes.backups.updateSettings.path, { method: 'PATCH', json: body }),
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: backupsKey });
      toast({ title: 'Schedule saved', tone: 'success' });
    },
    onError: (error) =>
      toast({ title: 'Could not save', description: errorText(error, 'Try again.'), tone: 'danger' }),
  });
  const change = (patch: Partial<typeof value>) => setDraft({ ...value, ...patch });
  return (
    <Card>
      <CardHeader
        title="Schedule"
        description="Backups run inside Darkbeacon, one at a time. Older automatic backups are removed; manual ones stay until you delete them."
      />
      <CardBody>
        <div className={styles.grid}>
          <Field label="Back up">
            <Select
              value={value.interval}
              options={intervals}
              onValueChange={(interval) => change({ interval })}
            />
          </Field>
          <Field
            label="Keep"
            hint="Newest automatic backups to keep"
            error={keepValid ? undefined : 'A number from 1 to 1000'}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              value={value.keep}
              onChange={(e) => change({ keep: e.target.value })}
            />
          </Field>
          <Field label="Remove automatic backups">
            <Select value={value.age} options={ages} onValueChange={(age) => change({ age })} />
          </Field>
        </div>
      </CardBody>
      <CardFooter>
        <span className={styles.footerNote}>
          {status.nextRunAt === null ? 'No scheduled backups' : `Next backup ${untilText(status.nextRunAt)}`}
        </span>
        {draft && (
          <Button variant="ghost" onClick={() => setDraft(null)}>
            Discard
          </Button>
        )}
        <Button
          variant="primary"
          disabled={!draft || !keepValid}
          loading={save.isPending}
          onClick={() =>
            save.mutate({
              intervalMinutes: value.interval === 'off' ? null : Number(value.interval),
              keep,
              maxAgeDays: value.age === 'none' ? null : Number(value.age),
            })
          }
        >
          Save
        </Button>
      </CardFooter>
    </Card>
  );
}

function AlertSettings({ settings }: { settings: BackupSettingsDto }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const save = useMutation({
    mutationFn: (body: UpdateBackupSettingsRequest) =>
      api<BackupSettingsDto>(routes.backups.updateSettings.path, { method: 'PATCH', json: body }),
    onSuccess: () => {
      setUrl('');
      void queryClient.invalidateQueries({ queryKey: backupsKey });
    },
    onError: (error) =>
      toast({ title: 'Could not save', description: errorText(error, 'Try again.'), tone: 'danger' }),
  });
  return (
    <Card>
      <CardHeader
        title="Alerts"
        description="Failed backups always show here. A webhook also tells you where you are: a Discord channel webhook or any address that takes a JSON POST."
      />
      <CardBody>
        <div className={styles.formStack}>
          {settings.notifyHost ? (
            <div className={styles.target}>
              <div className={styles.rowBody}>
                <div className={styles.rowTitle}>
                  Posting to {settings.notifyHost}
                  <Badge tone="success" dot>
                    On
                  </Badge>
                </div>
                <div className={styles.rowMeta}>Failures and restores; the address is kept secret.</div>
              </div>
              <Button size="sm" loading={save.isPending} onClick={() => save.mutate({ notifyUrl: null })}>
                Remove
              </Button>
            </div>
          ) : (
            <form
              className={styles.inline}
              aria-label="Alert webhook"
              onSubmit={(e) => {
                e.preventDefault();
                if (url.trim()) save.mutate({ notifyUrl: url.trim() });
              }}
            >
              <Field label="Webhook address" hint="Stored on the server and never shown again.">
                <Input
                  type="url"
                  autoComplete="off"
                  placeholder="https://discord.com/api/webhooks/…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
              <Button type="submit" loading={save.isPending} disabled={!url.trim()}>
                Save webhook
              </Button>
            </form>
          )}
          <Switch
            checked={settings.notifySuccess}
            disabled={save.isPending}
            onCheckedChange={(on) => save.mutate({ notifySuccess: on })}
            label="Also post successful backups"
            description="Off by default, so the channel only speaks up when something needs you."
          />
        </div>
      </CardBody>
    </Card>
  );
}

function RestoreFromFile({ maxBytes }: { maxBytes: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const tooBig = file !== null && file.size > maxBytes;
  const pick = (e: ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0] ?? null);
  const restore = () => {
    const form = new FormData();
    form.append('confirm', RESTORE_CONFIRMATION);
    form.append('file', file!, file!.name);
    return api<RestoreResultDto>(routes.backups.restoreUpload.path, { method: 'POST', body: form });
  };
  return (
    <Card>
      <CardHeader
        title="Restore from a file"
        description={`A backup downloaded from this or another Darkbeacon (.db.gz), or a plain SQLite file, up to ${formatBytes(maxBytes)}. It is checked before anything changes.`}
      />
      <CardBody>
        <input
          ref={input}
          type="file"
          accept=".gz,.db,.sqlite,application/gzip"
          className="sr-only"
          tabIndex={-1}
          onChange={pick}
          aria-label="Backup file"
        />
        <div className={own.picker}>
          <Button icon={<Upload />} onClick={() => input.current?.click()}>
            {file ? 'Choose another file' : 'Choose file'}
          </Button>
          {file ? (
            <span className={own.fileName}>
              <span className="mono">{file.name}</span> · {formatBytes(file.size)}
            </span>
          ) : (
            <span className={styles.rowMeta}>No file chosen</span>
          )}
        </div>
        {tooBig && (
          <div className={styles.rowNotes}>
            <Callout tone="danger" title="This file is too large">
              The server takes files up to {formatBytes(maxBytes)} (BACKUP_MAX_UPLOAD_MB).
            </Callout>
          </div>
        )}
      </CardBody>
      <CardFooter>
        <Button variant="danger" disabled={!file || tooBig} onClick={() => setConfirming(true)}>
          Restore from file…
        </Button>
      </CardFooter>
      <RestoreDialog
        open={confirming}
        onOpenChange={setConfirming}
        what={file ? file.name : 'the file'}
        restore={restore}
      />
    </Card>
  );
}
