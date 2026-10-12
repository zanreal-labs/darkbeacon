'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  STRUCTURE_STATUS_LABEL,
  STRUCTURE_TYPES,
  StructureStatus,
  TIMED_STRUCTURE_STATUSES,
  type StructureDto,
  type StructureOwnerDto,
} from '@darkbeacon/shared';
import { EvePicker, eveOption, type EveOption } from '../../components/pickers';
import { Button, Dialog, DialogClose, DialogContent, Field, Input, Select, Textarea } from '../../ui';

/** `2025-01-13T23:51` in UTC (EVE time) for a datetime-local field, and back. */
export const toEveInput = (ms: number | null) => (ms === null ? '' : new Date(ms).toISOString().slice(0, 16));
export const fromEveInput = (value: string): number | null => {
  if (!value) return null;
  const ms = Date.parse(`${value}:00Z`);
  return Number.isNaN(ms) ? null : ms;
};

export function ownerOption(owner: StructureOwnerDto | null): EveOption | null {
  return owner?.id
    ? eveOption({ id: owner.id, name: owner.name, category: 'corporation', ticker: owner.ticker })
    : null;
}

export const ownerOf = (option: EveOption | null): StructureOwnerDto | null =>
  option ? { id: option.entity.id, name: option.entity.name, ticker: option.entity.ticker } : null;

export interface StructureDraft {
  typeId: number | null;
  typeName: string;
  name: string;
  owner: StructureOwnerDto | null;
  status: StructureStatus;
  endsAt: number | null;
  notes: string;
}

/**
 * Edits a structure (or adds one by hand): name, owner corporation by name, status and its timer
 * in EVE time, notes. Statuses without a timer drop it.
 */
export function StructureEditor({
  structure,
  onSave,
  onRemove,
  onClose,
}: {
  /** Null adds a new one. */
  structure: StructureDto | null;
  onSave(draft: StructureDraft): Promise<unknown>;
  onRemove?(): Promise<unknown>;
  onClose(): void;
}) {
  const [typeId, setTypeId] = useState(structure?.typeId ?? 35832);
  const [name, setName] = useState(structure?.name ?? '');
  const [owner, setOwner] = useState<EveOption | null>(ownerOption(structure?.owner ?? null));
  const [status, setStatus] = useState<StructureStatus>(structure?.status ?? 'powered');
  const [endsAt, setEndsAt] = useState(toEveInput(structure?.endsAt ?? null));
  const [notes, setNotes] = useState(structure?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const timed = TIMED_STRUCTURE_STATUSES.includes(status);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSave({
        typeId: structure ? structure.typeId : typeId,
        typeName: structure ? structure.typeName : (STRUCTURE_TYPES[typeId] ?? 'Structure'),
        name: name.trim(),
        owner: ownerOf(owner),
        status,
        endsAt: timed ? fromEveInput(endsAt) : null,
        notes,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={structure ? `Structure ${structure.name}` : 'Add a structure'}
        width={440}
        footer={
          <>
            {onRemove && (
              <Button
                variant="danger-ghost"
                icon={<Trash2 />}
                onClick={() => void onRemove().then(onClose)}
                style={{ marginRight: 'auto' }}
              >
                Remove
              </Button>
            )}
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
              Save
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="Type">
            {structure ? (
              <Input value={structure.typeName} readOnly />
            ) : (
              <Select
                value={String(typeId)}
                onValueChange={(v) => setTypeId(Number(v))}
                options={Object.entries(STRUCTURE_TYPES).map(([id, label]) => ({ value: id, label }))}
              />
            )}
          </Field>
          <Field label="Name">
            <Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Owner" optional>
            <EvePicker category="corporation" value={owner} onChange={setOwner} />
          </Field>
          <Field label="Status">
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as StructureStatus)}
              options={StructureStatus.options.map((s) => ({ value: s, label: STRUCTURE_STATUS_LABEL[s] }))}
            />
          </Field>
          {timed && (
            <Field label="Timer ends (EVE time)">
              <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </Field>
          )}
          <Field label="Notes" optional>
            <Textarea value={notes} rows={3} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
