import { useEffect, useState, type ClipboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  buildPath,
  routes,
  SignatureGroup,
  type PasteSignaturesResult,
  type SignatureDto,
} from '@wormwright/shared';
import { Icon } from '../../components/Icon';
import { api } from '../../lib/api';
import type { MapPermissions } from '../../lib/roles';
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

function age(ms: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - ms) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function summary(r: PasteSignaturesResult): string {
  const parts = [`${r.added} added`, `${r.updated} updated`];
  if (r.removed) parts.push(`${r.removed} removed`);
  if (r.skipped.length) parts.push(`${r.skipped.length} lines skipped`);
  return parts.join(', ');
}

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

  return (
    <div className={styles.widget}>
      {can.edit && (
        <div className={styles.paste}>
          <textarea
            className={`input ${styles.pasteArea}`}
            aria-label="Paste probe scanner results"
            placeholder="Copy the probe scanner rows in game, then paste here (Ctrl+V)"
            rows={2}
            value=""
            onChange={() => {}}
            onPaste={onPaste}
            disabled={busy}
          />
          <div className={styles.pasteRow}>
            {'clipboard' in navigator && 'readText' in navigator.clipboard && (
              <button
                type="button"
                className="btn btn-small"
                onClick={() => void fromClipboard()}
                disabled={busy}
              >
                <Icon name="paste" size={12} /> Paste from clipboard
              </button>
            )}
            <label className={styles.check}>
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              Remove missing
            </label>
          </div>
          {result && (
            <p className={styles.result} role="status">
              {summary(result)}
            </p>
          )}
        </div>
      )}

      {sorted.length === 0 ? (
        <p className="muted">{listed.isLoading ? 'Loading…' : 'No signatures.'}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Group</th>
              <th>Type / name</th>
              <th title="Age">Age</th>
              {can.edit && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.id} data-group={s.group}>
                <td className={styles.mono}>{s.eveId}</td>
                <td>
                  {can.edit ? (
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
                          {g}
                        </option>
                      ))}
                    </select>
                  ) : (
                    s.group
                  )}
                </td>
                <td className={styles.ellipsis} title={s.description || undefined}>
                  {[s.type, s.name].filter(Boolean).join(' · ') || <span className="muted">—</span>}
                </td>
                <td className="muted">{age(s.createdAt)}</td>
                {can.edit && (
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      aria-label={`Remove ${s.eveId}`}
                      onClick={() => void store.removeSignature(s.id)}
                    >
                      <Icon name="close" size={12} />
                    </button>
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
