'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import {
  routes,
  TELEMETRY_DOCS_URL,
  type TelemetryOffReason,
  type TelemetryPayloadDto,
  type TelemetryStatusDto,
} from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import { relativeTime } from '../lib/time';
import { telemetryClientKey } from '../shell/Telemetry';
import { Badge, Button, Card, CardBody, CardHeader, ErrorState, Skeleton, Switch, useToast } from '../ui';
import settings from './settings.module.css';
import styles from './TelemetryCard.module.css';

export const telemetryStatusKey = ['admin-telemetry'] as const;

const REASON: Record<TelemetryOffReason, string> = {
  no_key: 'This build has no telemetry project key, so nothing is ever sent.',
  env_opt_out: 'Turned off on the server with TELEMETRY=off. The environment wins over this switch.',
  do_not_track: 'Turned off on the server with DO_NOT_TRACK=1. The environment wins over this switch.',
  not_production: 'Development and test servers never send anything.',
  admin_disabled: 'Turned off by an admin. Nothing is sent.',
};

/** The environment decides; the switch cannot turn these back on. */
const LOCKED: ReadonlySet<TelemetryOffReason> = new Set(['no_key', 'env_opt_out', 'do_not_track']);

/** Properties every event carries; shown once instead of on every payload. */
const COMMON = [
  'instance_id',
  'app_version',
  'demo',
  'origin',
  '$process_person_profile',
  '$geoip_disable',
  '$ip',
];

function split(properties: Record<string, unknown>) {
  const own: Record<string, unknown> = {};
  const common: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) (COMMON.includes(key) ? common : own)[key] = value;
  return { own, common };
}

const inline = (props: Record<string, unknown>) =>
  Object.entries(props)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('  ');

function Payload({ payload }: { payload: TelemetryPayloadDto }) {
  const { own, common } = split(payload.properties);
  return (
    <li className={styles.payload}>
      <div className={styles.payloadHead}>
        <strong>{payload.event}</strong>
        <span>
          {relativeTime(payload.at)} · {String(common.origin)} ·{' '}
          <span className="mono">{payload.distinctId}</span>
        </span>
      </div>
      {Object.keys(own).length > 0 && <code className={styles.props}>{inline(own)}</code>}
    </li>
  );
}

/** Admin tab: whether this instance reports, its random id, and every payload it sent lately. */
export function TelemetryCard() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const status = useQuery({
    queryKey: telemetryStatusKey,
    queryFn: () => api<TelemetryStatusDto>(routes.telemetry.status.path),
  });
  const save = useMutation({
    mutationFn: (enabled: boolean) =>
      api<TelemetryStatusDto>(routes.telemetry.setEnabled.path, { method: 'PUT', json: { enabled } }),
    onSuccess: (data) => {
      queryClient.setQueryData(telemetryStatusKey, data);
      void queryClient.invalidateQueries({ queryKey: telemetryClientKey });
      toast({ title: data.adminEnabled ? 'Telemetry turned on' : 'Telemetry turned off', tone: 'success' });
    },
    onError: (error) =>
      toast({
        title: 'Could not save',
        description: error instanceof ApiError ? error.message : 'Try again.',
        tone: 'danger',
      }),
  });
  const data = status.data;
  const locked = data?.reason ? LOCKED.has(data.reason) : false;

  return (
    <Card id="telemetry">
      <CardHeader
        title="Anonymous telemetry"
        description="Tells the Darkbeacon maintainers how many instances and people use it and which features matter. Counts and fixed choices only: no names, characters, systems, maps, IPs or text."
        actions={
          <Button asChild variant="ghost" size="sm" trailingIcon={<ArrowUpRight />}>
            <a href={TELEMETRY_DOCS_URL} target="_blank" rel="noreferrer">
              Field list
            </a>
          </Button>
        }
      />
      <CardBody>
        {status.isError ? (
          <ErrorState compact error={status.error} onRetry={() => void status.refetch()} />
        ) : !data ? (
          <Skeleton height={120} />
        ) : (
          <div className={styles.body}>
            <dl className={settings.facts}>
              <div className={settings.fact}>
                <dt>Status</dt>
                <dd>
                  <Badge tone={data.active ? 'success' : 'neutral'} dot>
                    {data.active ? 'Sending' : 'Off'}
                  </Badge>
                </dd>
              </div>
              <div className={settings.fact}>
                <dt>Instance id</dt>
                <dd className="mono" title={data.instanceId}>
                  {data.instanceId}
                </dd>
              </div>
              <div className={settings.fact}>
                <dt>Sends to</dt>
                <dd className="mono" title={data.host}>
                  {data.host}
                </dd>
              </div>
            </dl>
            <Switch
              checked={data.adminEnabled}
              disabled={save.isPending || locked}
              onCheckedChange={(on) => save.mutate(on)}
              label="Send anonymous usage statistics"
              description={
                data.reason
                  ? REASON[data.reason]
                  : 'A daily heartbeat with versions and counts, and which features were used. Turning it off is recorded in the audit.'
              }
            />
            <details className={styles.preview}>
              <summary>Preview what is sent</summary>
              <div className={styles.previewBody}>
                <p className={styles.label}>Sent with every event</p>
                <pre className={styles.json}>
                  {JSON.stringify(split(data.heartbeatPreview.properties).common, null, 2)}
                </pre>
                <p className={styles.label}>Daily heartbeat, as it would be sent now</p>
                <pre className={styles.json}>
                  {JSON.stringify(split(data.heartbeatPreview.properties).own, null, 2)}
                </pre>
                <p className={styles.label}>
                  Last {data.recent.length} sent
                  {data.dropped > 0 ? ` (${data.dropped} dropped by the rate cap)` : ''}
                </p>
                {data.recent.length === 0 ? (
                  <p className={settings.rowMeta}>Nothing sent since the server started.</p>
                ) : (
                  <ul className={styles.payloads}>
                    {data.recent.map((p, i) => (
                      <Payload key={`${p.at}-${i}`} payload={p} />
                    ))}
                  </ul>
                )}
              </div>
            </details>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
