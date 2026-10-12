'use client';

import { useEffect, useState, type ClipboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ClipboardPaste, Radar, X } from 'lucide-react';
import {
  buildPath,
  routes,
  SignatureGroup,
  type PasteSignaturesResult,
  type SignatureDto,
} from '@darkbeacon/shared';
import { api } from '../../lib/api';
import type { MapPermissions } from '../../lib/roles';
import { shortAge } from '../../lib/time';
import { Button, Checkbox, EmptyState, IconButton, Kbd, Skeleton } from '../../ui';
import { seedSignatures } from '../mapState';
import type { MapStore } from '../useMapStore';
import styles from './widgets.module.css';

interface Props {
  mapId: string;
  solarSystemId: number;
  signatures: SignatureDto[];
  /** False when the snapshot carried no signatures, so this widget loads them over REST. */
  streamed: boolean;
  can: MapPermissions;
  store: Pick<MapStore, 'pasteSignatures' | 'updateSignature' | 'removeSignature' | 'seed'>;
}

const GROUP_LABEL: Record<SignatureGroup, string> = {
  unknown: 'Unknown',
  wormhole: 'Wormhole',
  combat: 'Combat',
  relic: 'Relic',
  data: 'Data',
  gas: 'Gas',
  ore: 'Ore',
};

function summary(r: PasteSignaturesResult): string {
  const parts = [`${r.added} added`, `${r.updated} updated`];
  if (r.removed) parts.push(`${r.removed} removed`);
  if (r.skipped.length) parts.push(`${r.skipped.length} lines skipped`);
  return parts.join(', ');
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function SignaturesWidget({ mapId, solarSystemId, signatures, streamed, can, store }: Props) {
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PasteSignaturesResult | null>(null);

  const listed = useQuery({
    queryKey: ['signatures', mapId, solarSystemId],
    queryFn: () => api<SignatureDto[]>(buildPath(routes.signatures.list.path, { mapId, solarSystemId })),
    enabled: !streamed,
  });
  const { seed } = store;
  useEffect(() => {
    if (listed.data) seed((s) => seedSignatures(s, listed.data));
  }, [listed.data, seed]);

  const submit = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setResult(await store.pasteSignatures(solarSystemId, { text, mode: replace ? 'replace' : 'merge' }));
    setBusy(false);
  };

  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    void submit(e.clipboardData.getData('text/plain'));
  };

  const fromClipboard = async () => {
    try {
      await submit(await navigator.clipboard.readText());
    } catch {
      setResult(null);
    }
  };

  const sorted = [...signatures].sort((a, b) => a.eveId.localeCompare(b.eveId));
  const canReadClipboard =
    typeof navigator !== 'undefined' && 'clipboard' in navigator && 'readText' in navigator.clipboard;

  return (
    <div className={styles.widget}>
      {can.edit && (
        <div className={styles.section}>
          <label className={styles.pasteZone} data-busy={busy || undefined}>
            <ClipboardPaste aria-hidden />
            <span className={styles.pasteText}>
              <strong>Paste probe scanner results</strong>
              <span>
                Select the rows in game, copy, click here and press <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>{' '}
                <Kbd>V</Kbd>
              </span>
            </span>
            <textarea
              className={styles.pasteArea}
              aria-label="Paste probe scanner results"
              rows={1}
              value=""
              onChange={() => {}}
              onPaste={onPaste}
              disabled={busy}
            />
          </label>
          <div className={styles.pasteRow}>
            <Checkbox checked={replace} onCheckedChange={setReplace} label="Remove missing" />
            {canReadClipboard && (
              <Button
                size="sm"
                variant="ghost"
                icon={<ClipboardPaste />}
                loading={busy}
                onClick={() => void fromClipboard()}
              >
                From clipboard
              </Button>
            )}
          </div>
          {result && (
            <p className={styles.result} role="status">
              <CheckCircle2 aria-hidden />
              {summary(result)}
            </p>
          )}
        </div>
      )}

      {sorted.length === 0 ? (
        listed.isLoading ? (
          <div className={styles.section} aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={14} width={`${90 - i * 15}%`} style={{ marginBottom: 10 }} />
            ))}
          </div>
        ) : (
          <EmptyState
            compact
            icon={<Radar />}
            title="No signatures"
            description={
              can.edit ? 'Paste the probe scanner window to add them.' : 'Nobody has scanned here yet.'
            }
          />
        )
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">Group</th>
              <th scope="col">Name</th>
              <th scope="col" title="Age" className={styles.num}>
                Age
              </th>
              {can.edit && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.id} data-group={s.group}>
                <td className={`${styles.sigId} mono`}>{s.eveId}</td>
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
                <td
                  className={styles.ellipsis}
                  title={[s.type, s.name, s.description].filter(Boolean).join(' · ') || undefined}
                >
                  {[s.type, s.name].filter(Boolean).join(' · ') || <span className="subtle">—</span>}
                </td>
                <td className={`${styles.num} mono subtle`}>{shortAge(s.createdAt)}</td>
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
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
