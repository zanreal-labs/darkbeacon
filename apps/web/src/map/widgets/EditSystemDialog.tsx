'use client';

import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Check, CircleAlert, LoaderCircle, Settings, X } from 'lucide-react';
import {
  CUSTOM_LABEL_MAX,
  SystemStatus,
  type LabelDto,
  type MapSystemDto,
  type SystemLabelDto,
  type UniverseSystemDto,
  type UpdateSystemRequest,
} from '@darkbeacon/shared';
import { atLeast, type MapPermissions } from '../../lib/roles';
import { lockView, mapNames } from '../sharing/chain';
import { Button, Dialog, DialogClose, DialogContent, Input, Select, Switch } from '../../ui';
import { STATUS_LABEL, STATUS_MEANING, statusTint } from '../nodeFacts';
import node from '../SystemNode.module.css';
import type { MapStore } from '../useMapStore';
import { DesignationPill, isWormholeSpace, spaceText, statusColor } from './SystemDetails';
import css from './EditSystemDialog.module.css';

type Store = Pick<MapStore, 'updateSystem'>;

const NAME_MAX = 64;

/**
 * Edit system: everything about a system people set by hand, in one dialog opened from its
 * context menu, a double-click on it, or System info's pencil. Each change is saved as it is
 * made (a text field when it is left or on Enter), so the dialog only has to be closed.
 */
export function EditSystemDialog({
  system,
  info,
  labels,
  systemLabels,
  bookmark,
  can,
  store,
  managesSource,
  onManageLabels,
  onManageTags,
  onClose,
}: {
  /** The system edited; the dialog is open while there is one. */
  system: MapSystemDto | undefined;
  info: UniverseSystemDto | undefined;
  /** The map's Tags (`labels` in the data). */
  labels: readonly LabelDto[];
  /** The map's Labels (WH1...), in order. */
  systemLabels: readonly SystemLabelDto[];
  /** The bookmark label the map draws above the system, for the preview. */
  bookmark?: string | null;
  can: MapPermissions;
  store: Store;
  /** On a merged map: whether the viewer manages the map behind a source (lifts its locks). */
  managesSource?(sourceId: string): boolean;
  /** Opens the map's Labels settings (shown to managers). */
  onManageLabels?(): void;
  /** Opens the map's Tags settings (shown to managers). */
  onManageTags?(): void;
  onClose(): void;
}) {
  return (
    <Dialog open={!!system} onOpenChange={(open) => !open && onClose()}>
      {system && (
        <EditSystemContent
          // A field being edited belongs to its system: another system starts clean.
          key={system.solarSystemId}
          system={system}
          info={info}
          labels={labels}
          systemLabels={systemLabels}
          bookmark={bookmark ?? null}
          can={can}
          store={store}
          managesSource={managesSource}
          onManageLabels={can.manage ? onManageLabels : undefined}
          onManageTags={can.manage ? onManageTags : undefined}
        />
      )}
    </Dialog>
  );
}

type SaveState = 'saved' | 'saving' | 'failed';

/** Sends a change and keeps the header's "Saving…" / "Saved" / "Not saved" in step. */
function useSave(store: Store, id: number): { save(patch: UpdateSystemRequest): void; state: SaveState } {
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(false);
  const update = store.updateSystem;
  const save = useCallback(
    (patch: UpdateSystemRequest) => {
      setPending((n) => n + 1);
      setFailed(false);
      void update(id, patch).then((ok) => {
        setPending((n) => n - 1);
        if (!ok) setFailed(true);
      });
    },
    [update, id],
  );
  return { save, state: pending > 0 ? 'saving' : failed ? 'failed' : 'saved' };
}

function EditSystemContent({
  system,
  info,
  labels,
  systemLabels,
  bookmark,
  can,
  store,
  managesSource,
  onManageLabels,
  onManageTags,
}: {
  system: MapSystemDto;
  info: UniverseSystemDto | undefined;
  labels: readonly LabelDto[];
  systemLabels: readonly SystemLabelDto[];
  bookmark: string | null;
  can: MapPermissions;
  store: Store;
  managesSource?(sourceId: string): boolean;
  onManageLabels?(): void;
  onManageTags?(): void;
}) {
  const { save, state } = useSave(store, system.solarSystemId);
  const realName = info?.name ?? String(system.solarSystemId);
  // Region › constellation for known space; a wormhole's are codes (C-R00014) that tell a pilot
  // nothing, so it says what kind of space it is instead.
  const place = info
    ? isWormholeSpace(info)
      ? spaceText(info)
      : `${info.regionName} › ${info.constellationName}`
    : null;

  return (
    <DialogContent
      title={
        <span className={css.title}>
          <span className="sr-only">Edit system </span>
          <DesignationPill info={info} />
          <span className={css.realName}>{realName}</span>
        </span>
      }
      description={
        <span className={css.meta}>
          {place && <span>{place}</span>}
          <SaveIndicator state={state} />
        </span>
      }
      width={540}
      sheetOnPhone
      onEscapeKeyDown={(e) => {
        // Escape in a field with unsaved typing puts the field back; the next one closes.
        if (e.target instanceof HTMLElement && e.target.dataset.dirty) e.preventDefault();
      }}
      footer={
        <DialogClose asChild>
          <Button variant="primary">Close</Button>
        </DialogClose>
      }
    >
      <SystemForm
        system={system}
        realName={realName}
        info={info}
        labels={labels}
        systemLabels={systemLabels}
        bookmark={bookmark}
        can={can}
        managesSource={managesSource}
        save={save}
        onManageLabels={onManageLabels}
        onManageTags={onManageTags}
      />
    </DialogContent>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <span className={css.save} data-state={state} role="status" aria-live="polite">
      {state === 'saving' ? (
        <>
          <LoaderCircle className={css.spin} aria-hidden />
          Saving…
        </>
      ) : state === 'failed' ? (
        <>
          <CircleAlert aria-hidden />
          Not saved
        </>
      ) : (
        <>
          <Check aria-hidden />
          Saved
        </>
      )}
    </span>
  );
}

function SystemForm({
  system,
  realName,
  info,
  labels,
  systemLabels,
  bookmark,
  can,
  managesSource,
  save,
  onManageLabels,
  onManageTags,
}: {
  system: MapSystemDto;
  realName: string;
  info: UniverseSystemDto | undefined;
  labels: readonly LabelDto[];
  systemLabels: readonly SystemLabelDto[];
  bookmark: string | null;
  can: MapPermissions;
  managesSource?(sourceId: string): boolean;
  save(patch: UpdateSystemRequest): void;
  onManageLabels?(): void;
  onManageTags?(): void;
}) {
  const ids = useId();
  const lock = lockView(system, can.manage, managesSource);
  const lockedOn = mapNames(lock.on);
  const heldHere = lock.here || !lock.locked;
  const onLabels = system.systemLabelIds.filter((l) => systemLabels.some((x) => x.id === l));
  const toggleLabel = (labelId: string) => {
    const on = onLabels.includes(labelId);
    save({ systemLabelIds: on ? onLabels.filter((x) => x !== labelId) : [...onLabels, labelId] });
  };
  const toggleTag = (tagId: string) => {
    const on = system.labelIds.includes(tagId);
    save({ labelIds: on ? system.labelIds.filter((x) => x !== tagId) : [...system.labelIds, tagId] });
  };

  return (
    <div className={css.form}>
      <Section title="Name">
        <div className={css.pair}>
          <SubField id={`${ids}-custom`} label="Custom name">
            <DraftInput
              id={`${ids}-custom`}
              label="Custom name"
              value={system.customName ?? ''}
              placeholder={realName}
              maxLength={NAME_MAX}
              onCommit={(customName) => save({ customName })}
            />
          </SubField>
          <SubField id={`${ids}-temp`} label="Temporary name">
            <DraftInput
              id={`${ids}-temp`}
              label="Temporary name"
              value={system.temporaryName ?? ''}
              placeholder="e.g. C3a"
              maxLength={NAME_MAX}
              onCommit={(temporaryName) => save({ temporaryName })}
            />
          </SubField>
        </div>
      </Section>

      <Section title="Status">
        <div className={css.half}>
          <Select
            aria-label="Status"
            value={system.status}
            onValueChange={(status) => save({ status: status as SystemStatus })}
            options={SystemStatus.options.map((s) => ({
              value: s,
              label: (
                <span className={css.status}>
                  <span className={css.statusDot} style={{ background: statusColor(s) }} />
                  {STATUS_LABEL[s]}
                </span>
              ),
              description: STATUS_MEANING[s],
            }))}
          />
        </div>
      </Section>

      <Section
        title="Labels"
        action={onManageLabels && <ManageLink onClick={onManageLabels}>Manage labels</ManageLink>}
      >
        {systemLabels.length > 0 ? (
          <div className={css.chips} role="group" aria-label="Labels">
            {systemLabels.map((l) => {
              const on = onLabels.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  className={css.labelChip}
                  aria-pressed={on}
                  title={l.description || undefined}
                  onClick={() => toggleLabel(l.id)}
                >
                  {on && <Check aria-hidden />}
                  {l.name}
                </button>
              );
            })}
          </div>
        ) : (
          <p className={css.empty}>This map has no Labels.</p>
        )}
        <div className={css.pair}>
          <SubField
            id={`${ids}-custom-label`}
            label="Custom label"
            hint={`Up to ${CUSTOM_LABEL_MAX} characters, shown after the Labels.`}
          >
            <DraftInput
              id={`${ids}-custom-label`}
              label="Custom label"
              value={system.customLabel ?? ''}
              placeholder="e.g. HOME"
              maxLength={CUSTOM_LABEL_MAX}
              onCommit={(customLabel) => save({ customLabel })}
            />
          </SubField>
        </div>
        <Preview
          system={system}
          realName={realName}
          info={info}
          labels={labels}
          systemLabels={systemLabels}
          bookmark={bookmark}
        />
      </Section>

      {(labels.length > 0 || onManageTags) && (
        <Section
          title="Tags"
          action={onManageTags && <ManageLink onClick={onManageTags}>Manage tags</ManageLink>}
        >
          {labels.length > 0 ? (
            <div className={css.chips} role="group" aria-label="Tags">
              {labels.map((t) => {
                const on = system.labelIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={css.tagChip}
                    aria-pressed={on}
                    title={t.description || undefined}
                    style={{ '--tag': t.color, '--tag-text': textOn(t.color) } as CSSProperties}
                    onClick={() => toggleTag(t.id)}
                  >
                    {on ? <Check aria-hidden /> : <span className={css.swatch} aria-hidden />}
                    {t.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className={css.empty}>This map has no Tags yet.</p>
          )}
        </Section>
      )}

      <Section title="Notes" htmlFor={`${ids}-notes`}>
        <NotesInput
          id={`${ids}-notes`}
          value={system.description}
          onCommit={(description) => save({ description })}
        />
        <p className={css.hint}>
          Markdown: <code>**bold**</code>, <code>- list</code>, <code>[link](https://…)</code>. Saved when you
          leave the field or press Ctrl+Enter.
        </p>
      </Section>

      {/* This map's lock is its managers'; one a merged map holds is lifted there, by its managers. */}
      {(heldHere ? can.manage : atLeast(can.role, 'member')) && (
        <div className={css.lock}>
          <Switch
            checked={system.locked}
            label="Lock position"
            description={
              heldHere
                ? 'Nobody can move or remove the system on the map while it is locked.'
                : lock.canUnlock
                  ? `Locked on ${lockedOn}. Turning this off unlocks it there.`
                  : `Locked on ${lockedOn}: only a manager of ${lockedOn} can unlock it.`
            }
            disabled={!heldHere && !lock.canUnlock}
            onCheckedChange={(locked) => save({ locked })}
          />
        </div>
      )}
    </div>
  );
}

/** A section of the form: its title (the label of its control, when it has one) above it. */
function Section({
  title,
  htmlFor,
  action,
  children,
}: {
  title: string;
  htmlFor?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const Title = htmlFor ? 'label' : 'h3';
  return (
    <section className={css.section}>
      <div className={css.sectionHead}>
        <Title className={css.sectionTitle} htmlFor={htmlFor}>
          {title}
        </Title>
        {action}
      </div>
      {children}
    </section>
  );
}

function SubField({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className={css.subField}>
      <label className={css.subLabel} htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && <span className={css.hint}>{hint}</span>}
    </div>
  );
}

function ManageLink({ onClick, children }: { onClick(): void; children: ReactNode }) {
  return (
    <Button variant="ghost" size="sm" icon={<Settings />} className={css.manage} onClick={onClick}>
      {children}
    </Button>
  );
}

/**
 * The draft of a text field while it is edited: saved on Enter or when the field is left,
 * Escape puts the saved value back. `dirty` marks unsaved typing (Escape then keeps the dialog).
 */
function useDraft(value: string) {
  const [draft, setDraft] = useState<string | null>(null);
  return {
    shown: draft ?? value,
    dirty: draft !== null && draft !== value,
    start: () => setDraft(value),
    change: (next: string) => setDraft(next),
    reset: () => setDraft(null),
    /** The value to save, or undefined when nothing changed; ends the edit. */
    take(trim = true): string | undefined {
      if (draft === null) return undefined;
      setDraft(null);
      const next = trim ? draft.trim() : draft;
      return next === value ? undefined : next;
    },
  };
}

function DraftInput({
  id,
  label,
  value,
  placeholder,
  maxLength,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  maxLength: number;
  onCommit(value: string | null): void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const d = useDraft(value);
  const commit = () => {
    const next = d.take();
    if (next !== undefined) onCommit(next === '' ? null : next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') d.reset();
  };
  return (
    <Input
      ref={ref}
      id={id}
      maxLength={maxLength}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      value={d.shown}
      data-dirty={d.dirty || undefined}
      onFocus={d.start}
      onChange={(e) => d.change(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      trailing={
        d.shown ? (
          <button
            type="button"
            className={css.clear}
            aria-label={`Clear ${label.toLowerCase()}`}
            title="Clear"
            tabIndex={-1}
            // Keeps the focus in the field, so leaving it does not save the text first.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              d.reset();
              if (value) onCommit(null);
            }}
          >
            <X aria-hidden />
          </button>
        ) : null
      }
    />
  );
}

/** The notes' Markdown source: five rows at least, growing with the text. */
function NotesInput({ id, value, onCommit }: { id: string; value: string; onCommit(value: string): void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const d = useDraft(value);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 360)}px`;
  }, [d.shown]);
  const commit = () => {
    const next = d.take(false);
    if (next !== undefined) onCommit(next);
  };
  return (
    <div className={css.notesControl}>
      <textarea
        ref={ref}
        id={id}
        className={css.notes}
        rows={5}
        maxLength={10_000}
        placeholder="Structures, who lives here, what to watch for…"
        value={d.shown}
        data-dirty={d.dirty || undefined}
        onFocus={d.start}
        onChange={(e) => d.change(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') d.reset();
        }}
      />
    </div>
  );
}

/** The chips above the node as the map draws them, in its order, over the top of the node. */
function Preview({
  system,
  realName,
  info,
  labels,
  systemLabels,
  bookmark,
}: {
  system: MapSystemDto;
  realName: string;
  info: UniverseSystemDto | undefined;
  labels: readonly LabelDto[];
  systemLabels: readonly SystemLabelDto[];
  bookmark: string | null;
}) {
  const own = systemLabels.filter((l) => system.systemLabelIds.includes(l.id));
  const tags = labels.filter((t) => system.labelIds.includes(t.id));
  const empty = own.length === 0 && !system.customLabel && !bookmark && tags.length === 0;
  return (
    <figure className={css.preview} aria-label="On the map">
      <figcaption className={css.subLabel}>On the map</figcaption>
      <div className={css.canvas}>
        <ul className={css.above} aria-label="Above the system">
          {own.map((l) => (
            <li key={l.id} className={node.systemLabel}>
              {l.name}
            </li>
          ))}
          {system.customLabel && (
            <li className={node.systemLabel} data-custom>
              {system.customLabel}
            </li>
          )}
          {bookmark && <li className={node.bookmark}>{bookmark}</li>}
          {tags.map((t) => (
            <li key={t.id} className={node.label} style={{ '--label-color': t.color } as CSSProperties}>
              {t.name}
            </li>
          ))}
          {empty && <li className={css.nothing}>Nothing above the system</li>}
        </ul>
        <div
          className={css.node}
          style={{ '--node-tint-image': statusTint(system.status) } as CSSProperties}
          aria-hidden
        >
          <DesignationPill info={info} />
          <span className={css.nodeName}>{system.customName || realName}</span>
        </div>
      </div>
    </figure>
  );
}

/** Dark or white text, whichever reads better on a tag's colour. */
function textOn(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 'var(--dbk-color-text)';
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast with near-black (#0b0d12) against contrast with white: the larger wins.
  return (luminance + 0.05) / 0.0545 >= 1.05 / (luminance + 0.05) ? '#0b0d12' : '#ffffff';
}
