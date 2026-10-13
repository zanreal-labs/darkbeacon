'use client';

import type { CSSProperties } from 'react';
import {
  CUSTOM_LABEL_MAX,
  SystemStatus,
  type LabelDto,
  type MapSystemDto,
  type SystemLabelDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import type { MapPermissions } from '../../lib/roles';
import { Button, Checkbox, Dialog, DialogClose, DialogContent } from '../../ui';
import { STATUS_LABEL } from '../nodeFacts';
import type { MapStore } from '../useMapStore';
import { InlineText } from './InlineText';
import { NotesField } from './NotesField';
import { DesignationPill, statusColor } from './SystemDetails';
import styles from './widgets.module.css';

type Store = Pick<MapStore, 'updateSystem'>;

/**
 * Edit system: everything about a system people set by hand, in one dialog opened from its
 * context menu, a double-click on it, or System info's pencil. Each change is saved as it is
 * made (a field when it is left), so the dialog only has to be closed.
 */
export function EditSystemDialog({
  system,
  info,
  labels,
  systemLabels,
  can,
  store,
  onClose,
}: {
  /** The system edited; the dialog is open while there is one. */
  system: MapSystemDto | undefined;
  info: UniverseSystemDto | undefined;
  /** The map's Tags (`labels` in the data). */
  labels: readonly LabelDto[];
  /** The map's Labels (WH1...), in order. */
  systemLabels: readonly SystemLabelDto[];
  can: MapPermissions;
  store: Store;
  onClose(): void;
}) {
  return (
    <Dialog open={!!system} onOpenChange={(open) => !open && onClose()}>
      {system && (
        <DialogContent
          title={
            <span className={styles.editTitle}>
              Edit system
              <DesignationPill info={info} />
              <span>{info?.name ?? system.solarSystemId}</span>
            </span>
          }
          description="Changes are saved as you make them."
          width={520}
          footer={
            <DialogClose asChild>
              <Button variant="primary">Done</Button>
            </DialogClose>
          }
        >
          <SystemForm
            // A field being edited belongs to its system: another system starts clean.
            key={system.solarSystemId}
            system={system}
            labels={labels}
            systemLabels={systemLabels}
            can={can}
            store={store}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

function SystemForm({
  system,
  labels,
  systemLabels,
  can,
  store,
}: {
  system: MapSystemDto;
  labels: readonly LabelDto[];
  systemLabels: readonly SystemLabelDto[];
  can: MapPermissions;
  store: Store;
}) {
  const id = system.solarSystemId;
  const update = store.updateSystem;
  const toggleTag = (tagId: string) => {
    const on = system.labelIds.includes(tagId);
    void update(id, {
      labelIds: on ? system.labelIds.filter((x) => x !== tagId) : [...system.labelIds, tagId],
    });
  };
  const onLabels = system.systemLabelIds.filter((l) => systemLabels.some((x) => x.id === l));
  const toggleLabel = (labelId: string) => {
    const on = onLabels.includes(labelId);
    void update(id, {
      systemLabelIds: on ? onLabels.filter((x) => x !== labelId) : [...onLabels, labelId],
    });
  };

  return (
    <div className={styles.editForm}>
      <dl className={styles.props}>
        <dt>Name</dt>
        <dd className={styles.names}>
          <InlineText
            label="Custom name"
            value={system.customName ?? ''}
            placeholder="—"
            maxLength={64}
            onCommit={(customName) => void update(id, { customName })}
          />
          <span className={styles.namesLabel} aria-hidden>
            Temp.
          </span>
          <InlineText
            label="Temporary name"
            value={system.temporaryName ?? ''}
            placeholder="—"
            maxLength={64}
            onCommit={(temporaryName) => void update(id, { temporaryName })}
          />
        </dd>

        <dt>Status</dt>
        <dd className={styles.labelChips} role="radiogroup" aria-label="Status">
          {SystemStatus.options.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={system.status === s}
              className={styles.labelChip}
              style={{ '--label-color': statusColor(s) } as CSSProperties}
              onClick={() => void update(id, { status: s })}
            >
              <span className={styles.labelSwatch} />
              {STATUS_LABEL[s]}
            </button>
          ))}
        </dd>

        <dt>Labels</dt>
        <dd className={styles.labelChips} role="group" aria-label="Labels">
          {systemLabels.map((l) => (
            <button
              key={l.id}
              type="button"
              className={styles.systemLabelChip}
              aria-pressed={onLabels.includes(l.id)}
              title={l.description || undefined}
              onClick={() => toggleLabel(l.id)}
            >
              {l.name}
            </button>
          ))}
          <span className={styles.customLabel}>
            <InlineText
              label="Custom label"
              value={system.customLabel ?? ''}
              placeholder="Custom"
              maxLength={CUSTOM_LABEL_MAX}
              onCommit={(customLabel) => void update(id, { customLabel })}
            />
          </span>
        </dd>

        {labels.length > 0 && (
          <>
            <dt>Tags</dt>
            <dd className={styles.labelChips} role="group" aria-label="Tags">
              {labels.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={styles.labelChip}
                  aria-pressed={system.labelIds.includes(t.id)}
                  title={t.description || undefined}
                  style={{ '--label-color': t.color } as CSSProperties}
                  onClick={() => toggleTag(t.id)}
                >
                  <span className={styles.labelSwatch} />
                  {t.name}
                </button>
              ))}
            </dd>
          </>
        )}

        {can.manage && (
          <>
            <dt>Position</dt>
            <dd>
              <Checkbox
                checked={system.locked}
                label="Locked"
                onCheckedChange={(locked) => void update(id, { locked })}
              />
            </dd>
          </>
        )}

        <dt className={styles.notesTerm}>Notes</dt>
        <dd className={styles.notesValue}>
          <NotesField
            editable
            value={system.description}
            placeholder="Structures, who lives here, what to watch for… (Markdown)"
            onCommit={(description) => void update(id, { description })}
          />
        </dd>
      </dl>
    </div>
  );
}
