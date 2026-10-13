'use client';

import { useEffect, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Building2, ClipboardPaste, Pencil, Plus, UsersRound } from 'lucide-react';
import {
  buildPath,
  routes,
  STRUCTURE_STATUS_LABEL,
  TIMED_STRUCTURE_STATUSES,
  type PasteStructuresResult,
  type StructureDto,
} from '@darkbeacon/shared';
import { EvePicker, type EveOption } from '../../components/pickers';
import { api, ApiError } from '../../lib/api';
import type { MapPermissions } from '../../lib/roles';
import {
  Avatar,
  Button,
  corporationLogoUrl,
  Dialog,
  DialogClose,
  DialogContent,
  Field,
  IconButton,
  Skeleton,
  useToast,
} from '../../ui';
import { WidgetWindow } from './WidgetWindow';
import { ownerOf, StructureEditor, type StructureDraft } from './StructureEditor';
import { useSystemList } from './useSystemList';
import styles from './widgets.module.css';
import own from './records.module.css';

const byAdded = (a: StructureDto, b: StructureDto) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);

/** Time left as `HH:MM:SS` (hours not capped), or `00:00:00` once it ran out. */
export function countdown(endsAt: number, now: number): string {
  const s = Math.max(0, Math.floor((endsAt - now) / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * Structures in the system: paste d-scan rows (one structure each) or a structure's timer (its
 * three lines) into the section; type, name, owner, status and a live countdown in EVE time.
 * Double click (or the pencil) edits; Delete removes the selected one; one owner can be set for
 * all of them.
 */
export function StructuresSection({
  mapId,
  solarSystemId,
  can,
}: {
  mapId: string;
  solarSystemId: number;
  can: MapPermissions;
}) {
  const toast = useToast();
  const now = useNow();
  const structures = useSystemList<StructureDto>({
    key: 'structures',
    path: buildPath(routes.structures.list.path, { mapId, solarSystemId }),
    mapId,
    solarSystemId,
    events: { upsert: ['structure.added', 'structure.updated'], remove: 'structure.removed' },
    order: byAdded,
  });
  const [editing, setEditing] = useState<StructureDto | 'new' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [owners, setOwners] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = structures.data ?? [];
  // The timer that runs out first, for the title bar.
  const next = list
    .filter((s) => TIMED_STRUCTURE_STATUSES.includes(s.status) && s.endsAt !== null && s.endsAt > now)
    .sort((a, b) => a.endsAt! - b.endsAt!)[0];

  const fail = (title: string) => (error: unknown) =>
    toast({
      title,
      description: error instanceof ApiError ? error.message : 'Network error',
      tone: 'danger',
    });

  const paste = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const r = await api<PasteStructuresResult>(
        buildPath(routes.structures.paste.path, { mapId, solarSystemId }),
        {
          method: 'POST',
          json: { text },
        },
      );
      toast({
        title:
          r.added || r.updated
            ? [r.added && `${r.added} added`, r.updated && `${r.updated} timer set`]
                .filter(Boolean)
                .join(' / ')
            : 'Nothing new',
        description: r.skipped.length
          ? `${r.skipped.length} ${r.skipped.length === 1 ? 'line' : 'lines'} not understood (d-scan rows of Upwell structures, or a structure's timer)`
          : undefined,
        tone: r.added || r.updated ? 'success' : 'info',
      });
    } catch (error) {
      fail('Could not read the structures')(error);
    } finally {
      setBusy(false);
    }
  };

  const save = async (draft: StructureDraft) => {
    if (editing === 'new') {
      await api(buildPath(routes.structures.add.path, { mapId, solarSystemId }), {
        method: 'POST',
        json: draft,
      }).catch(fail('Could not add the structure'));
    } else if (editing) {
      const { typeId: _t, typeName: _n, ...patch } = draft;
      await api(buildPath(routes.structures.update.path, { mapId, structureId: editing.id }), {
        method: 'PATCH',
        json: patch,
      }).catch(fail('Could not save the structure'));
    }
  };

  const remove = (id: string) =>
    api(buildPath(routes.structures.remove.path, { mapId, structureId: id }), { method: 'DELETE' }).catch(
      fail('Could not remove the structure'),
    );

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected && can.edit) {
      e.preventDefault();
      void remove(selected);
      setSelected(null);
    }
  };

  return (
    <WidgetWindow
      id="structures"
      title="Structures"
      count={structures.data ? list.length : undefined}
      summary={next ? `${STRUCTURE_STATUS_LABEL[next.status]} ${countdown(next.endsAt!, now)}` : undefined}
      alert={!!next}
      actions={
        can.edit && (
          <span className={own.headerActions}>
            {list.length > 1 && (
              <IconButton
                size="sm"
                label="One owner for all"
                tooltipSide="left"
                icon={<UsersRound />}
                onClick={() => setOwners(true)}
              />
            )}
            <IconButton
              size="sm"
              label="Add a structure"
              tooltipSide="left"
              icon={<Plus />}
              onClick={() => setEditing('new')}
            />
          </span>
        )
      }
    >
      <div className={own.structures} tabIndex={-1} onKeyDown={onKeyDown}>
        {can.edit && (
          <label className={styles.pasteZone} data-busy={busy || undefined}>
            <ClipboardPaste aria-hidden />
            <span>Paste d-scan rows or a timer</span>
            <textarea
              className={styles.pasteArea}
              aria-label="Paste structures or a timer"
              rows={1}
              value=""
              onChange={() => {}}
              onPaste={(e: ClipboardEvent) => {
                e.preventDefault();
                void paste(e.clipboardData.getData('text/plain'));
              }}
              disabled={busy}
            />
          </label>
        )}
        {structures.isLoading ? (
          <Skeleton height={14} width="70%" />
        ) : list.length === 0 ? (
          <p className={styles.empty}>
            <Building2 aria-hidden />
            No structures noted here.
          </p>
        ) : (
          <table className={`${styles.table} ${own.structureTable}`}>
            <thead>
              <tr>
                <th scope="col">Type / name</th>
                <th scope="col">Owner</th>
                <th scope="col">Status</th>
                <th scope="col" className={styles.num}>
                  Timer
                </th>
                {can.edit && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const timed = TIMED_STRUCTURE_STATUSES.includes(s.status);
                return (
                  <tr
                    key={s.id}
                    data-selected={selected === s.id || undefined}
                    data-status={s.status}
                    onClick={() => setSelected((c) => (c === s.id ? null : s.id))}
                    onDoubleClick={() => can.edit && setEditing(s)}
                  >
                    <td>
                      <span
                        className={own.structureName}
                        title={[`${s.typeName}: ${s.name}`, s.notes].filter(Boolean).join('\n')}
                      >
                        {s.typeId && (
                          <Avatar
                            src={`https://images.evetech.net/types/${s.typeId}/icon?size=32`}
                            name={s.typeName}
                            size={18}
                            shape="rounded"
                          />
                        )}
                        <span className={styles.ellipsis}>
                          {s.name}
                          {!s.typeId && <span className={own.structureType}> {s.typeName}</span>}
                        </span>
                      </span>
                    </td>
                    <td>
                      {s.owner ? (
                        <span className={own.owner} title={s.owner.name}>
                          {s.owner.id && (
                            <Avatar
                              src={corporationLogoUrl(s.owner.id, 32)}
                              name={s.owner.name}
                              size={16}
                              shape="rounded"
                            />
                          )}
                          <span className={styles.ellipsis}>
                            {s.owner.ticker ? `[${s.owner.ticker}]` : s.owner.name}
                          </span>
                        </span>
                      ) : (
                        <span className="subtle">—</span>
                      )}
                    </td>
                    <td className={own.status}>{STRUCTURE_STATUS_LABEL[s.status]}</td>
                    <td className={`${styles.num} ${styles.age}`}>
                      {timed &&
                        (s.endsAt ? (
                          <span
                            className={own.timer}
                            data-over={s.endsAt <= now || undefined}
                            title={`${new Date(s.endsAt).toISOString().slice(0, 16).replace('T', ' ')} EVE`}
                          >
                            {countdown(s.endsAt, now)}
                          </span>
                        ) : (
                          can.edit && (
                            <button type="button" className={own.setTimer} onClick={() => setEditing(s)}>
                              Set timer
                            </button>
                          )
                        ))}
                    </td>
                    {can.edit && (
                      <td className={styles.actionCell}>
                        <IconButton
                          size="sm"
                          tooltip={false}
                          className={styles.rowRemove}
                          label={`Edit ${s.name}`}
                          icon={<Pencil />}
                          onClick={() => setEditing(s)}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {editing && (
        <StructureEditor
          structure={editing === 'new' ? null : editing}
          onSave={save}
          onRemove={editing === 'new' ? undefined : () => remove(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
      {owners && (
        <OwnersDialog
          structures={list}
          onClose={() => setOwners(false)}
          onSave={(owner) =>
            api(buildPath(routes.structures.setOwners.path, { mapId, solarSystemId }), {
              method: 'PUT',
              json: { owner: ownerOf(owner) },
            }).catch(fail('Could not set the owner'))
          }
        />
      )}
    </WidgetWindow>
  );
}

function OwnersDialog({
  structures,
  onSave,
  onClose,
}: {
  structures: StructureDto[];
  onSave(owner: EveOption | null): Promise<unknown>;
  onClose(): void;
}) {
  const [owner, setOwner] = useState<EveOption | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="One owner for all structures"
        description="Sets the owner of every structure noted in this system."
        width={420}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="primary"
              loading={busy}
              onClick={() => {
                setBusy(true);
                void onSave(owner).finally(() => {
                  setBusy(false);
                  onClose();
                });
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <ul className={own.ownerList}>
          {structures.map((s) => (
            <li key={s.id}>
              {s.typeName} · {s.name}
            </li>
          ))}
        </ul>
        <Field label="Owner">
          <EvePicker category="corporation" value={owner} onChange={setOwner} />
        </Field>
      </DialogContent>
    </Dialog>
  );
}
