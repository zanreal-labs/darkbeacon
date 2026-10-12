'use client';

import { useCallback, useEffect, useState, type ClipboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ClipboardPaste, Radar, X } from 'lucide-react';
import {
  buildPath,
  routes,
  SignatureGroup,
  type ConnectionDto,
  type PasteSignaturesResult,
  type SignatureDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { api } from '../../lib/api';
import type { MapPermissions } from '../../lib/roles';
import { shortAge } from '../../lib/time';
import { Checkbox, IconButton, Kbd, Skeleton, useToast } from '../../ui';
import { seedSignatures } from '../mapState';
import type { MapStore } from '../useMapStore';
import { InlineText } from './InlineText';
import styles from './sidebar.module.css';

export const GROUP_LABEL: Record<SignatureGroup, string> = {
  unknown: 'Unknown',
  wormhole: 'Wormhole',
  combat: 'Combat',
  relic: 'Relic',
  data: 'Data',
  gas: 'Gas',
  ore: 'Ore',
};

/** "3 new / 1 updated", and what else the paste did. */
export function pasteSummary(r: PasteSignaturesResult): { title: string; description?: string } {
  const parts = [`${r.added} new`, `${r.updated} updated`];
  if (r.removed) parts.push(`${r.removed} removed`);
  const skipped = r.skipped.length;
  return {
    title: parts.join(' / '),
    description: skipped ? `${skipped} ${skipped === 1 ? 'line' : 'lines'} not understood` : undefined,
  };
}

/** Probe scanner rows start with the signature id the game shows, `ABC-123`. */
export const looksLikeScanner = (text: string) => /^\s*[A-Z]{3}-\d{3}\b/m.test(text);

export interface SignaturePaste {
  busy: boolean;
  replace: boolean;
  setReplace(replace: boolean): void;
  submit(text: string): Promise<void>;
}

/** Sends probe scanner text for the selected system and reports what changed in a toast. */
export function useSignaturePaste(
  solarSystemId: number | null,
  store: Pick<MapStore, 'pasteSignatures'>,
): SignaturePaste {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [replace, setReplace] = useState(false);
  const { pasteSignatures } = store;
  const submit = useCallback(
    async (text: string) => {
      if (solarSystemId === null || !text.trim() || busy) return;
      setBusy(true);
      const result = await pasteSignatures(solarSystemId, { text, mode: replace ? 'replace' : 'merge' });
      setBusy(false);
      if (result) toast({ ...pasteSummary(result), tone: 'success' });
    },
    [solarSystemId, busy, pasteSignatures, replace, toast],
  );
  return { busy, replace, setReplace, submit };
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export const canReadClipboard = () =>
  typeof navigator !== 'undefined' && 'clipboard' in navigator && 'readText' in navigator.clipboard;

/** Reads the clipboard and pastes it (the section header's action). */
export async function pasteFromClipboard(paste: SignaturePaste) {
  try {
    await paste.submit(await navigator.clipboard.readText());
  } catch {
    // Permission refused: Ctrl+V still works.
  }
}

interface Props {
  mapId: string;
  solarSystemId: number;
  signatures: SignatureDto[];
  /** False when the snapshot carried no signatures, so this section loads them over REST. */
  streamed: boolean;
  connections: Map<string, ConnectionDto>;
  universe: Map<number, UniverseSystemDto>;
  can: MapPermissions;
  store: Pick<MapStore, 'updateSignature' | 'removeSignature' | 'seed'>;
  paste: SignaturePaste;
  /** Selects the system a wormhole signature leads to. */
  onSelectSystem(solarSystemId: number): void;
}

/** Where a wormhole signature leads: the other end of its connection. */
function targetOf(sig: SignatureDto, connections: Map<string, ConnectionDto>): number | null {
  const c = sig.connectionId ? connections.get(sig.connectionId) : undefined;
  if (!c) return null;
  return c.source === sig.solarSystemId ? c.target : c.source;
}

export function SignaturesSection({
  mapId,
  solarSystemId,
  signatures,
  streamed,
  connections,
  universe,
  can,
  store,
  paste,
  onSelectSystem,
}: Props) {
  const listed = useQuery({
    queryKey: ['signatures', mapId, solarSystemId],
    queryFn: () => api<SignatureDto[]>(buildPath(routes.signatures.list.path, { mapId, solarSystemId })),
    enabled: !streamed,
  });
  const { seed } = store;
  useEffect(() => {
    if (listed.data) seed((s) => seedSignatures(s, listed.data));
  }, [listed.data, seed]);

  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    void paste.submit(e.clipboardData.getData('text/plain'));
  };

  const sorted = [...signatures].sort((a, b) => a.eveId.localeCompare(b.eveId));
  // Probed signatures first; anomalies and other scanner rows fold away (collapsed by default).
  const probed = sorted.filter((x) => (x.kind ?? 'signature') === 'signature');
  const others = sorted.filter((x) => (x.kind ?? 'signature') !== 'signature');
  const [showOthers, setShowOthers] = useState(false);
  const [filter, setFilter] = useState<(typeof OTHER_FILTERS)[number]['value']>('all');

  return (
    <div className={styles.signatures}>
      {can.edit && (
        <div className={styles.pasteRow}>
          <label className={styles.pasteZone} data-busy={paste.busy || undefined}>
            <ClipboardPaste aria-hidden />
            <span>
              <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd> <Kbd>V</Kbd> pastes the scan
            </span>
            <textarea
              className={styles.pasteArea}
              aria-label="Paste probe scanner results"
              rows={1}
              value=""
              onChange={() => {}}
              onPaste={onPaste}
              disabled={paste.busy}
            />
          </label>
          <Checkbox
            className={styles.replace}
            checked={paste.replace}
            onCheckedChange={paste.setReplace}
            label="Remove missing"
          />
        </div>
      )}

      {probed.length === 0 ? (
        listed.isLoading ? (
          <div className={styles.padded} aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={14} width={`${90 - i * 15}%`} style={{ marginBottom: 10 }} />
            ))}
          </div>
        ) : (
          <p className={styles.empty}>
            <Radar aria-hidden />
            {others.length > 0
              ? 'No probed signatures yet.'
              : can.edit
                ? 'No signatures yet. Copy the probe scanner and paste.'
                : 'Nobody has scanned here yet.'}
          </p>
        )
      ) : (
        <SignatureTable
          rows={probed}
          label="Signatures"
          can={can}
          store={store}
          connections={connections}
          universe={universe}
          onSelectSystem={onSelectSystem}
        />
      )}
      {others.length > 0 && (
        <div className={styles.others}>
          <button
            type="button"
            className={styles.othersToggle}
            aria-expanded={showOthers}
            onClick={() => setShowOthers((v) => !v)}
          >
            <ChevronRight className={styles.chevron} aria-hidden />
            Anomalies and other results
            <span className={styles.sectionCount}>{others.length}</span>
          </button>
          {showOthers && (
            <>
              <div className={styles.othersFilter} role="group" aria-label="Show">
                {OTHER_FILTERS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    className={styles.filterChip}
                    aria-pressed={filter === f.value}
                    onClick={() => setFilter(f.value)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <SignatureTable
                rows={others.filter(
                  (x) =>
                    filter === 'all' ||
                    (filter === 'other' ? x.kind === 'other' : x.kind === 'anomaly' && x.group === filter),
                )}
                label="Anomalies and other results"
                can={can}
                store={store}
                connections={connections}
                universe={universe}
                onSelectSystem={onSelectSystem}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

const OTHER_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'combat', label: 'Combat' },
  { value: 'ore', label: 'Ore' },
  { value: 'relic', label: 'Relic' },
  { value: 'data', label: 'Data' },
  { value: 'gas', label: 'Gas' },
  { value: 'other', label: 'Other' },
] as const;

/** One table of scan results: id (custom entries marked), group, type or name, age, remove. */
function SignatureTable({
  rows: sorted,
  label,
  can,
  store,
  connections,
  universe,
  onSelectSystem,
}: {
  rows: SignatureDto[];
  label: string;
  can: MapPermissions;
  store: Pick<MapStore, 'updateSignature' | 'removeSignature'>;
  connections: Map<string, ConnectionDto>;
  universe: Map<number, UniverseSystemDto>;
  onSelectSystem(solarSystemId: number): void;
}) {
  if (sorted.length === 0) return null;
  return (
    <table className={styles.table} data-edit={can.edit || undefined} aria-label={label}>
      <thead>
        <tr>
          <th scope="col">ID</th>
          <th scope="col">Group</th>
          <th scope="col">Type / name</th>
          <th scope="col" className={styles.num}>
            Age
          </th>
          {can.edit && <th aria-label="Actions" />}
        </tr>
      </thead>
      <tbody>
        {sorted.map((s) => {
          const target = targetOf(s, connections);
          const targetName = target !== null ? (universe.get(target)?.name ?? '…') : null;
          const wormhole = s.group === 'wormhole';
          const text = [s.type, s.name].filter(Boolean).join(' · ');
          return (
            <tr key={s.id} data-group={s.group}>
              <td className={styles.sigId}>
                {s.eveId}
                {s.custom && (
                  <span className={styles.customMark} title="Written by someone, not from the scanner">
                    custom
                  </span>
                )}
              </td>
              <td>
                {can.edit ? (
                  <span className={styles.groupSelect}>
                    <select
                      className={styles.inlineSelect}
                      aria-label={`Group of ${s.eveId}`}
                      value={s.group}
                      onChange={(e) =>
                        void store.updateSignature(s.id, { group: e.target.value as SignatureGroup })
                      }
                    >
                      {SignatureGroup.options.map((g) => (
                        <option key={g} value={g}>
                          {GROUP_LABEL[g]}
                        </option>
                      ))}
                    </select>
                  </span>
                ) : (
                  GROUP_LABEL[s.group]
                )}
              </td>
              <td title={[text, s.description].filter(Boolean).join(' · ') || undefined}>
                <span className={styles.typeCell} data-wormhole={wormhole || undefined}>
                  {can.edit ? (
                    <InlineText
                      label={wormhole ? `Wormhole type of ${s.eveId}` : `Name of ${s.eveId}`}
                      mono={wormhole}
                      value={(wormhole ? s.type : s.name) ?? ''}
                      placeholder={wormhole ? 'Type' : '—'}
                      maxLength={wormhole ? 64 : 128}
                      onCommit={(v) => void store.updateSignature(s.id, wormhole ? { type: v } : { name: v })}
                    />
                  ) : (
                    <span className={styles.ellipsis}>{text || <span className="subtle">—</span>}</span>
                  )}
                  {target !== null && (
                    <button
                      type="button"
                      className={styles.target}
                      title={`Leads to ${targetName}: select it`}
                      onClick={() => onSelectSystem(target)}
                    >
                      <span aria-hidden>→ </span>
                      {targetName}
                    </button>
                  )}
                </span>
              </td>
              <td className={`${styles.num} ${styles.age}`}>{shortAge(s.createdAt)}</td>
              {can.edit && (
                <td className={styles.actionCell}>
                  <IconButton
                    size="sm"
                    tooltip={false}
                    className={styles.rowRemove}
                    label={`Remove ${s.eveId}`}
                    icon={<X />}
                    onClick={() => void store.removeSignature(s.id)}
                  />
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
