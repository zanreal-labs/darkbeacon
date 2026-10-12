'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  buildPath,
  DEFAULT_SIGNATURE_RETENTION_DAYS,
  routes,
  type MapDto,
  type UpdateMapRequest,
} from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import { Button, Card, CardBody, CardHeader, Field, Select, useToast } from '../ui';

const CHOICES = [1, 3, 7, 14, 30, 60, 0] as const;
const label = (days: number) =>
  days === 0
    ? 'Keep them'
    : days === 1
      ? '1 day'
      : `${days} days${days === DEFAULT_SIGNATURE_RETENTION_DAYS ? ' (as Wanderer)' : ''}`;

/**
 * Map settings: how long signatures nobody changed or scanned again are kept before the server
 * removes them (14 days unless set). Admins.
 */
export function SignatureRetention({ map }: { map: MapDto }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const saved = map.settings.signatureRetentionDays ?? DEFAULT_SIGNATURE_RETENTION_DAYS;
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
        description="Signatures nobody changed or scanned again for this long are removed by the server. A paste that sees a signature again keeps it."
      />
      <CardBody>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--dbk-space-3)', flexWrap: 'wrap' }}>
          <Field
            label="Remove signatures after"
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
