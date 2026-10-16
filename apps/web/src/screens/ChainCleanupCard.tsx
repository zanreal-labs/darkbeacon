'use client';

import type { InstanceSettingsDto, UpdateInstanceSettingsRequest } from '@darkbeacon/shared';
import { Card, CardBody, CardHeader, Field, Select, Switch } from '../ui';
import styles from './settings.module.css';

const DELETE_AFTER = [
  { value: '0', label: 'At once' },
  { value: '30', label: '30 minutes later' },
  { value: '60', label: '1 hour later' },
  { value: '120', label: '2 hours later' },
];
const IDLE_FOR = [
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '360', label: '6 hours' },
  { value: '1440', label: '24 hours' },
];

/**
 * The sweeper's switches (Admin, Instance): what the server tidies up on every map as time
 * passes. Locked connections and systems are always left alone.
 */
export function ChainCleanupCard({
  settings,
  saving,
  onSave,
}: {
  settings: InstanceSettingsDto | undefined;
  saving: boolean;
  onSave(patch: UpdateInstanceSettingsRequest): void;
}) {
  const busy = !settings || saving;
  const deleteAfter = settings?.expiredConnectionMinutes ?? null;
  const idle = settings?.staleSystemMinutes ?? null;
  return (
    <Card>
      <CardHeader
        title="Chain cleanup"
        description="What the server tidies up on every map every five minutes. Locked connections and systems are left alone."
      />
      <CardBody>
        <div className={styles.formStack}>
          <Switch
            checked={settings?.autoEol ?? true}
            disabled={busy}
            onCheckedChange={(autoEol) => onSave({ autoEol })}
            label="Mark wormholes end of life on time"
            description="When the last 4 hours of a hole’s lifetime begin (its type’s lifetime, else the usual one for the classes it joins), it turns EOL and the map’s notifications say so."
          />
          <Switch
            checked={deleteAfter !== null}
            disabled={busy}
            onCheckedChange={(on) => onSave({ expiredConnectionMinutes: on ? 60 : null })}
            label="Delete wormholes that cannot exist any more"
            description="Once its lifetime since it was last seen (drawn, its signature pasted, a jump), or 4 hours after it was marked EOL, has passed. A hole someone jumped in the last hour always stays."
          />
          {deleteAfter !== null && (
            <Field label="Delete them">
              <Select
                value={String(deleteAfter)}
                disabled={busy}
                options={DELETE_AFTER}
                onValueChange={(v) => onSave({ expiredConnectionMinutes: Number(v) })}
              />
            </Field>
          )}
          <Switch
            checked={idle !== null}
            disabled={busy}
            onCheckedChange={(on) => onSave({ staleSystemMinutes: on ? 15 : null })}
            label="Hide systems left alone"
            description="Systems with no connection, nobody tracked in them, no lock and not home. They keep their notes and signatures if they come back."
          />
          {idle !== null && (
            <Field label="After nobody touched them for">
              <Select
                value={String(idle)}
                disabled={busy}
                options={IDLE_FOR}
                onValueChange={(v) => onSave({ staleSystemMinutes: Number(v) })}
              />
            </Field>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
