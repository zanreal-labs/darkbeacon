import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  LabelDto,
  MapSystemDto,
  SystemStatus,
  UniverseSystemDto,
  UpdateSystemRequest,
} from '@wormwright/shared';
import { cssVar } from '@wormwright/theme-sdk';
import type { MapPermissions } from '../../lib/roles';
import { systemClass } from '../../lib/universe';
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

  return (
    <div className={styles.widget}>
      <div className={styles.headline}>
        <span style={{ color: cssVar(cls.token), fontWeight: 700 }}>{cls.label}</span>
        <strong>{info?.name ?? system.solarSystemId}</strong>
      </div>
      {info && (
        <p className={styles.meta}>
          {info.regionName} · {info.constellationName} · sec {info.security.toFixed(2)}
        </p>
      )}

      {can.edit ? (
        <form className={styles.form} onSubmit={submit}>
          <label className="field">
            <span>Status</span>
            <select
              className="input"
              value={system.status}
              onChange={(e) =>
                void store.updateSystem(system.solarSystemId, { status: e.target.value as SystemStatus })
              }
            >
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.pair}>
            <label className="field">
              <span>Custom name</span>
              <input
                ref={nameRef}
                className="input"
                maxLength={64}
                value={draft.customName}
                onChange={(e) => setDraft({ ...draft, customName: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Tag</span>
              <input
                className="input"
                maxLength={16}
                value={draft.tag}
                onChange={(e) => setDraft({ ...draft, tag: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>Temporary name</span>
            <input
              className="input"
              maxLength={64}
              value={draft.temporaryName}
              onChange={(e) => setDraft({ ...draft, temporaryName: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea
              className="input"
              rows={4}
              maxLength={10_000}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>
          {labels.length > 0 && (
            <fieldset className={styles.labels}>
              <legend>Labels</legend>
              {labels.map((l) => {
                const on = system.labelIds.includes(l.id);
                return (
                  <label key={l.id} title={l.description || undefined} className={styles.labelToggle}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        void store.updateSystem(system.solarSystemId, {
                          labelIds: on
                            ? system.labelIds.filter((x) => x !== l.id)
                            : [...system.labelIds, l.id],
                        })
                      }
                    />
                    <span className={styles.swatch} style={{ background: l.color }} />
                    {l.name}
                  </label>
                );
              })}
            </fieldset>
          )}
          <div className={styles.actions}>
            <button type="submit" className="btn btn-primary btn-small" disabled={!dirty}>
              Save
            </button>
            {dirty && (
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => setDraft(draftOf(system))}
              >
                Discard
              </button>
            )}
          </div>
        </form>
      ) : (
        <>
          {system.tag && <p>Tag: {system.tag}</p>}
          <p className={styles.notes}>{system.description || <span className="muted">No notes.</span>}</p>
        </>
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
