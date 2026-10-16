'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  buildPath,
  DEFAULT_SIGNATURE_RETENTION_DAYS,
  routes,
  SIGNATURE_LAZY_DELETE_HOURS,
  type MapDto,
  type UpdateMapRequest,
} from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import { Button, Card, CardBody, CardHeader, Field, Select, Switch, useToast } from '../ui';

const CHOICES = [1, 3, 7, 14, 30, 60, 0] as const;
const label = (days: number) =>
  days === 0
    ? 'Keep them'
    : days === 1
      ? '1 day'
      : `${days} days${days === DEFAULT_SIGNATURE_RETENTION_DAYS ? ' (as Wanderer)' : ''}`;

/**
 * Map settings: the lazy delete (on unless switched off: scanner results go a day after they were
 * added, linked holes stay while their connection does) and how long signatures nobody changed or
 * scanned again are kept before the server removes them (14 days unless set). Admins.
 */
export function SignatureRetention({ map }: { map: MapDto }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const saved = map.settings.signatureRetentionDays ?? DEFAULT_SIGNATURE_RETENTION_DAYS;
  const lazyDelete = map.settings.signatureLazyDelete ?? true;
  const [days, setDays] = useState(saved);
  const save = useMutation({
    mutationFn: (body: UpdateMapRequest) =>
      api<MapDto>(buildPath(routes.maps.update.path, { mapId: map.id }), { method: 'PATCH', json: body }),
    onSuccess: (next) => {
      queryClient.setQueryData(['map', next.slug], next);
      toast({ title: 'Signature settings saved', tone: 'success' });
    },
  });
  return (
    <Card>
      <CardHeader
        title="Old signatures"
        description="When the server removes signatures. Every removal is in the map's history, and a Wanderer sync does not bring them back."
      />
      <CardBody>
        <div style={{ marginBottom: 'var(--dbk-space-4)' }}>
          <Switch
            checked={lazyDelete}
            disabled={save.isPending}
            onCheckedChange={(on) => save.mutate({ settings: { signatureLazyDelete: on } })}
            label={`Lazy delete after ${SIGNATURE_LAZY_DELETE_HOURS} hours`}
            description={`Scanned signatures are removed ${SIGNATURE_LAZY_DELETE_HOURS} hours after they were added, so yesterday's scan does not linger. Wormholes linked to a connection stay while the connection does; custom entries stay.`}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--dbk-space-3)', flexWrap: 'wrap' }}>
          <Field
            label="Remove signatures nobody changed or scanned again after"
            error={
              save.error
                ? save.error instanceof ApiError
                  ? save.error.message
                  : 'Could not save.'
                : undefined
            }
          >
            <Select
              value={String(days)}
              onValueChange={(v) => setDays(Number(v))}
              options={CHOICES.map((d) => ({ value: String(d), label: label(d) }))}
            />
          </Field>
          <Button
            variant="primary"
            disabled={days === saved}
            loading={save.isPending}
            onClick={() => save.mutate({ settings: { signatureRetentionDays: days } })}
          >
            Save
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
