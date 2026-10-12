import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import type {
  LabelDto,
  MapSystemDto,
  SystemStatus,
  UniverseSystemDto,
  UpdateSystemRequest,
} from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import type { MapPermissions } from '../../lib/roles';
import { systemClass } from '../../lib/universe';
import { Button, Field, Input, Select, StatusDot, Textarea } from '../../ui';
import { statusOptions } from '../menus';
import type { MapStore } from '../useMapStore';
import styles from './widgets.module.css';

interface Props {
  system: MapSystemDto;
  info: UniverseSystemDto | undefined;
  labels: LabelDto[];
  can: MapPermissions;
  store: Pick<MapStore, 'updateSystem'>;
  /** Bumped to move focus to the name field (from the context menu). */
  focusToken: number;
}

const blankToNull = (v: string) => (v.trim() === '' ? null : v.trim());

const STATUS_SELECT = statusOptions.map((o) => ({
  value: o.value,
  label: o.label,
  icon: (
    <span className={styles.statusDot} style={{ background: o.color ?? 'var(--dbk-color-border-strong)' }} />
  ),
}));

/** Security with two decimals, coloured like the class label. */
function SystemFacts({ info }: { info: UniverseSystemDto }) {
  return (
    <p className={styles.facts}>
      <span>{info.regionName}</span>
      <span aria-hidden>·</span>
      <span>{info.constellationName}</span>
      <span aria-hidden>·</span>
      <span className="tabular" style={{ color: cssVar(systemClass(info).token) }} title="Security status">
        {info.security.toFixed(2)}
      </span>
    </p>
  );
}

export function SystemInfoWidget({ system, info, labels, can, store, focusToken }: Props) {
  const cls = systemClass(info);
  const nameRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => draftOf(system));
  const [seen, setSeen] = useState(system);

  // Fields changed elsewhere (stream, menu) overwrite the draft; untouched edits stay.
  if (seen !== system) {
    const before = draftOf(seen);
    const after = draftOf(system);
    const sameSystem = seen.solarSystemId === system.solarSystemId;
    setSeen(system);
    setDraft((d) => {
      if (!sameSystem) return after;
      const next = { ...d };
      for (const key of Object.keys(after) as (keyof typeof after)[]) {
        if (before[key] !== after[key]) next[key] = after[key];
      }
      return next;
    });
  }

  useEffect(() => {
    if (focusToken > 0) nameRef.current?.focus();
  }, [focusToken]);

  const patch: UpdateSystemRequest = {};
  if (blankToNull(draft.customName) !== system.customName) patch.customName = blankToNull(draft.customName);
  if (blankToNull(draft.temporaryName) !== system.temporaryName)
    patch.temporaryName = blankToNull(draft.temporaryName);
  if (blankToNull(draft.tag) !== system.tag) patch.tag = blankToNull(draft.tag);
  if (draft.description !== system.description) patch.description = draft.description;
  const dirty = Object.keys(patch).length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (dirty) void store.updateSystem(system.solarSystemId, patch);
  };

  const realName = info?.name ?? String(system.solarSystemId);
  const shownName = system.customName || system.temporaryName;
  const toggleLabel = (id: string) => {
    const on = system.labelIds.includes(id);
    void store.updateSystem(system.solarSystemId, {
      labelIds: on ? system.labelIds.filter((x) => x !== id) : [...system.labelIds, id],
    });
  };

  return (
    <div className={styles.widget}>
      <header className={styles.systemHeader}>
        <div className={styles.titleRow}>
          <span className={styles.classChip} style={{ '--chip-color': cssVar(cls.token) } as CSSProperties}>
            {cls.label}
          </span>
          <h2 className={styles.systemName}>{shownName || realName}</h2>
          {system.tag && <span className={`${styles.tag} mono`}>{system.tag}</span>}
          {system.locked && (
            <span className={styles.lock} title="Locked">
              <Lock aria-label="Locked" />
            </span>
          )}
        </div>
        {shownName && <p className={`${styles.realName} mono`}>{realName}</p>}
        {info && <SystemFacts info={info} />}
      </header>

      {can.edit ? (
        <form className={styles.form} onSubmit={submit} aria-label="System details">
          <Field label="Status">
            <Select
              value={system.status}
              options={STATUS_SELECT}
              onValueChange={(status) =>
                void store.updateSystem(system.solarSystemId, { status: status as SystemStatus })
              }
            />
          </Field>
          {labels.length > 0 && (
            <div className={styles.fieldGroup} role="group" aria-label="Labels">
              <span className={styles.groupLabel}>Labels</span>
              <div className={styles.labelChips}>
                {labels.map((l) => {
                  const on = system.labelIds.includes(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      className={styles.labelChip}
                      aria-pressed={on}
                      title={l.description || undefined}
                      style={{ '--label-color': l.color } as CSSProperties}
                      onClick={() => toggleLabel(l.id)}
                    >
                      <span className={styles.labelSwatch} />
                      {l.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className={styles.pair}>
            <Field label="Custom name">
              <Input
                ref={nameRef}
                maxLength={64}
                placeholder={realName}
                value={draft.customName}
                onChange={(e) => setDraft({ ...draft, customName: e.target.value })}
              />
            </Field>
            <Field label="Tag">
              <Input
                mono
                maxLength={16}
                placeholder="A1"
                value={draft.tag}
                onChange={(e) => setDraft({ ...draft, tag: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Temporary name" hint="For the current chain only, e.g. a bookmark name.">
            <Input
              maxLength={64}
              value={draft.temporaryName}
              onChange={(e) => setDraft({ ...draft, temporaryName: e.target.value })}
            />
          </Field>
          <Field label="Notes">
            <Textarea
              rows={5}
              maxLength={10_000}
              placeholder="Statics, structures, who lives here…"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </Field>
          {dirty && (
            <div className={styles.saveBar}>
              <span className={styles.saveHint}>Unsaved changes</span>
              <Button size="sm" variant="ghost" onClick={() => setDraft(draftOf(system))}>
                Discard
              </Button>
              <Button size="sm" type="submit" variant="primary">
                Save
              </Button>
            </div>
          )}
        </form>
      ) : (
        <div className={styles.readOnly}>
          {system.status !== 'unknown' && (
            <span className={styles.statusLine}>
              <StatusDot
                color={statusOptions.find((o) => o.value === system.status)?.color ?? 'transparent'}
              />
              {statusOptions.find((o) => o.value === system.status)?.label}
            </span>
          )}
          <div className={styles.fieldGroup}>
            <span className={styles.groupLabel}>Notes</span>
            <p className={styles.notes}>
              {system.description || <span className="subtle">No notes yet.</span>}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function draftOf(s: MapSystemDto) {
  return {
    customName: s.customName ?? '',
    temporaryName: s.temporaryName ?? '',
    tag: s.tag ?? '',
    description: s.description,
  };
}
