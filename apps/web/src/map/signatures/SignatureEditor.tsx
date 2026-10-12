'use client';

import { useState, type FormEvent } from 'react';
import {
  MassStatus,
  type SignatureGroup,
  TimeStatus,
  type ConnectionDto,
  type SignatureDestination,
  type SignatureDto,
  type UniverseSystemDto,
  type UpdateSignatureRequest,
} from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  Field,
  Input,
  Segmented,
  Select,
  Textarea,
} from '../../ui';
import { systemClass } from '../../lib/universe';
import { typeFacts, TypeLabel, useWormholeCatalog } from './catalog';
import {
  DESTINATION_LABEL,
  destinationChoices,
  GROUP_LABEL,
  leadsToChoices,
  MULTI_DESTINATION_TYPES,
  targetOf,
  typeChoices,
} from './facts';
import styles from './signatures.module.css';

const NONE = '__none';
const TIME_LABEL: Record<string, string> = { normal: 'Normal', eol: 'EOL' };
const MASS_LABEL: Record<string, string> = { fresh: 'Fresh', reduced: 'Reduced', critical: 'Critical' };
const label = (labels: Record<string, string>, v: string) => labels[v] ?? v;

/** Group order of the editor, as in Wanderer: unknown first, then wormholes, then sites. */
const GROUP_ORDER: SignatureGroup[] = ['unknown', 'wormhole', 'gas', 'relic', 'data', 'ore', 'combat'];

interface Props {
  signature: SignatureDto;
  system: UniverseSystemDto | undefined;
  connections: Map<string, ConnectionDto>;
  universe: Map<number, UniverseSystemDto>;
  /** Names of systems on the map (custom name or real name). */
  systemName(solarSystemId: number): string;
  onSave(patch: UpdateSignatureRequest): Promise<unknown>;
  onClose(): void;
}

/**
 * The signature editor (double-click a row): group, then the wormhole's type, destination, the
 * system it leads to, lifetime, mass, bubble and temporary name, or a site's name, and a Markdown
 * description. Lifetime and mass of a linked signature are its connection's.
 */
export function SignatureEditor({
  signature,
  system,
  connections,
  universe,
  systemName,
  onSave,
  onClose,
}: Props) {
  const linked = signature.connectionId ? connections.get(signature.connectionId) : undefined;
  const [group, setGroup] = useState<SignatureGroup>(signature.group);
  const [type, setType] = useState(signature.type ?? '');
  const [name, setName] = useState(signature.name ?? '');
  const [destination, setDestination] = useState<SignatureDestination | null>(signature.destination ?? null);
  const [leadsTo, setLeadsTo] = useState<string | null>(signature.connectionId);
  const [timeStatus, setTimeStatus] = useState<string>(
    linked?.timeStatus ?? signature.timeStatus ?? 'normal',
  );
  const [massStatus, setMassStatus] = useState<string>(linked?.massStatus ?? signature.massStatus ?? 'fresh');
  const [bubbled, setBubbled] = useState(signature.bubbled ?? false);
  const [tempName, setTempName] = useState(signature.tempName ?? '');
  const [description, setDescription] = useState(signature.description);
  const [busy, setBusy] = useState(false);
  const catalog = useWormholeCatalog();

  const wormhole = group === 'wormhole';
  const code = type.trim().toUpperCase();
  const choices = typeChoices(system);
  const listed = new Set([...choices.statics, ...choices.wandering]);
  const typeOption = (c: string) => ({
    value: c,
    label: <TypeLabel code={c} title={typeFacts(catalog.byCode.get(c))} />,
  });
  const typeOptions = [
    { value: NONE, label: 'Not known yet' },
    ...(code && !listed.has(code) ? [typeOption(code)] : []),
    { value: '__statics', label: 'Statics', disabled: true },
    ...choices.statics.map(typeOption),
    ...(choices.wandering.length > 0
      ? [{ value: '__wandering', label: 'Wandering', disabled: true }, ...choices.wandering.map(typeOption)]
      : []),
  ];
  const destinations = destinationChoices(code);
  const draft = { ...signature, type: code || null, destination };
  const leads = leadsToChoices(draft, connections.values(), universe);
  const current = targetOf(signature, connections);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const patch: UpdateSignatureRequest = { group, description };
    if (wormhole) {
      patch.type = code || null;
      patch.destination = MULTI_DESTINATION_TYPES.includes(code as 'K162') ? destination : null;
      patch.tempName = tempName.trim() || null;
      patch.bubbled = bubbled;
      if (leadsTo !== signature.connectionId) patch.connectionId = leadsTo;
      // A linked hole's state is its connection's: only what was changed here is sent.
      const wasTime = linked?.timeStatus ?? signature.timeStatus ?? 'normal';
      const wasMass = linked?.massStatus ?? signature.massStatus ?? 'fresh';
      if (timeStatus !== wasTime) patch.timeStatus = timeStatus as UpdateSignatureRequest['timeStatus'];
      if (massStatus !== wasMass) patch.massStatus = massStatus as UpdateSignatureRequest['massStatus'];
      if (signature.group !== 'wormhole') patch.name = null;
    } else {
      patch.name = group === 'unknown' ? null : name.trim() || null;
      if (signature.group === 'wormhole') {
        patch.type = null;
        if (signature.connectionId) patch.connectionId = null;
      }
    }
    setBusy(true);
    try {
      await onSave(patch);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={`Signature ${signature.eveId}`}
        width={440}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button variant="primary" loading={busy} onClick={() => void submit()}>
              Save
            </Button>
          </>
        }
      >
        <form className={styles.editor} onSubmit={(e) => void submit(e)}>
          <Field label="Group">
            <Select
              value={group}
              onValueChange={(v) => setGroup(v as SignatureGroup)}
              options={GROUP_ORDER.map((g) => ({ value: g, label: GROUP_LABEL[g] }))}
            />
          </Field>

          {wormhole ? (
            <>
              <Field label="Type">
                <Select
                  value={code || NONE}
                  onValueChange={(v) => setType(v === NONE ? '' : v)}
                  options={typeOptions}
                />
              </Field>
              {destinations.length > 0 && (
                <Field label="Leads to class">
                  <Select
                    value={destination ?? NONE}
                    onValueChange={(v) => setDestination(v === NONE ? null : (v as SignatureDestination))}
                    options={[
                      { value: NONE, label: 'Not known' },
                      ...destinations.map((d) => ({ value: d, label: DESTINATION_LABEL[d] })),
                    ]}
                  />
                </Field>
              )}
              <Field
                label="Leads to system"
                hint={leads.length === 0 ? 'No connection from this system yet.' : undefined}
              >
                <Select
                  value={leadsTo ?? NONE}
                  onValueChange={(v) => setLeadsTo(v === NONE ? null : v)}
                  disabled={leads.length === 0}
                  options={[
                    { value: NONE, label: 'Not linked' },
                    ...leads
                      .filter((l) => l.fits || l.systemId === current)
                      .map((l) => {
                        const pill = systemClass(universe.get(l.systemId));
                        return {
                          value: l.connection.id,
                          label: (
                            <span className={styles.leadsOption}>
                              <span style={{ color: cssVar(pill.token) }}>{pill.label}</span>
                              {systemName(l.systemId)}
                            </span>
                          ),
                        };
                      }),
                  ]}
                />
              </Field>
              <Field label="Lifetime">
                <Segmented
                  aria-label="Lifetime"
                  value={timeStatus}
                  onValueChange={setTimeStatus}
                  options={TimeStatus.options.map((v) => ({ value: v, label: label(TIME_LABEL, v) }))}
                />
              </Field>
              <Field label="Mass">
                <Segmented
                  aria-label="Mass"
                  value={massStatus}
                  onValueChange={setMassStatus}
                  options={MassStatus.options.map((v) => ({ value: v, label: label(MASS_LABEL, v) }))}
                />
              </Field>
              <Checkbox checked={bubbled} onCheckedChange={setBubbled} label="Hole is inside a bubble" />
              <Field label="Temporary name" hint="Given to the system it leads to when linked.">
                <Input value={tempName} maxLength={64} onChange={(e) => setTempName(e.target.value)} />
              </Field>
            </>
          ) : (
            group !== 'unknown' && (
              <Field label="Name">
                <Input value={name} maxLength={128} onChange={(e) => setName(e.target.value)} />
              </Field>
            )
          )}

          <Field label="Description" hint="Markdown.">
            <Textarea
              value={description}
              rows={3}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
              }}
            />
          </Field>
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}
