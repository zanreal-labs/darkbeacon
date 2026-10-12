'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { buildPath, routes, type MapDto, type MapRole } from '@darkbeacon/shared';
import { api, ApiError } from '../../lib/api';
import { Card, CardBody, CardHeader, Field, Select, useToast } from '../../ui';
import styles from '../../screens/settings.module.css';

const ROLES: Array<{ value: MapRole; label: string }> = [
  { value: 'viewer', label: 'Viewers and up' },
  { value: 'member', label: 'Members and up' },
  { value: 'manager', label: 'Managers and up' },
  { value: 'admin', label: 'Admins only' },
];

/**
 * Who may copy systems off this map and paste systems onto it (Wanderer's copy and paste roles).
 * Managers set it; it applies at once.
 */
export function ClipboardRoles({ map }: { map: MapDto }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const roles = map.settings.clipboard ?? { copy: 'viewer', paste: 'member' };
  const save = useMutation({
    mutationFn: (next: { copy: MapRole; paste: MapRole }) =>
      api<MapDto>(buildPath(routes.clipboard.setRoles.path, { mapId: map.id }), {
        method: 'PUT',
        json: next,
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(['map', next.slug], next);
      toast({ title: 'Saved', tone: 'success', duration: 2000 });
    },
    onError: (error) =>
      toast({
        title: 'Not saved',
        description: error instanceof ApiError ? error.message : 'Network error',
        tone: 'danger',
      }),
  });
  return (
    <Card>
      <CardHeader
        title="Copying systems"
        description="Ctrl+C on a selection copies systems with their status, names, notes, Labels and Tags; Ctrl+V pastes them on another map."
      />
      <CardBody>
        <div className={styles.grid}>
          <Field label="Who may copy systems off this map">
            <Select
              value={roles.copy}
              disabled={save.isPending}
              onValueChange={(copy) => save.mutate({ ...roles, copy: copy as MapRole })}
              options={ROLES}
            />
          </Field>
          <Field label="Who may paste systems onto it" hint="Pasting changes the map, so viewers never may.">
            <Select
              value={roles.paste}
              disabled={save.isPending}
              onValueChange={(paste) => save.mutate({ ...roles, paste: paste as MapRole })}
              options={ROLES.filter((r) => r.value !== 'viewer')}
            />
          </Field>
        </div>
      </CardBody>
    </Card>
  );
}
