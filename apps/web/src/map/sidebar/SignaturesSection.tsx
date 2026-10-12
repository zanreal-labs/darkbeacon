'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  CircleDot,
  ClipboardPaste,
  Clock,
  MessageSquareText,
  Pencil,
  Radar,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react';
import {
  buildPath,
  routes,
  type ConnectionDto,
  type ConnectionIntelDto,
  type PasteSignaturesResult,
  type SignatureDto,
  type UniverseSystemDto,
  type UpdateSignatureRequest,
} from '@darkbeacon/shared';
import { api } from '../../lib/api';
import type { MapPermissions } from '../../lib/roles';
import { Button, Checkbox, CharacterAvatar, IconButton, Kbd, Skeleton, useToast } from '../../ui';
import { seedSignatures } from '../mapState';
import { TypeLabel } from '../signatures/catalog';
import { ageLabel, freshness, GROUP_LABEL, targetOf, visibleSignatures } from '../signatures/facts';
import { LeadsToMenu } from '../signatures/LeadsToMenu';
import {
  setSignaturePrefs,
  signaturePrefs,
  useSignaturePrefs,
  type SignatureSortField,
} from '../signatures/prefs';
import { SignatureEditor } from '../signatures/SignatureEditor';
import { rememberRemoved, useSignatureRemoval, useUndo } from '../signatures/undo';
import type { MapStore } from '../useMapStore';
import styles from './sidebar.module.css';
import sig from '../signatures/signatures.module.css';

export { GROUP_LABEL };

/** "3 new / 1 updated", and what else the paste did. */
export function pasteSummary(r: PasteSignaturesResult): { title: string; description?: string } {
  const parts = [`${r.added} new`, `${r.updated} updated`];
  if (r.removed) parts.push(`${r.removed} removed`);
  const skipped = r.skipped.length;
  return {
    title: parts.join(' / '),
    description: skipped
      ? `${skipped} ${skipped === 1 ? 'line' : 'lines'} not understood (scanner columns or client language)`
      : undefined,
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

/**
 * Sends probe scanner text for the selected system and reports what changed in a toast. "Remove
 * missing" (lazy delete) starts as the preferences say and turns itself off after a paste unless
 * they say to keep it; what it removed can be put back for the undo window.
 */
export function useSignaturePaste(
  solarSystemId: number | null,
  store: Pick<MapStore, 'pasteSignatures'>,
): SignaturePaste {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [replace, setReplace] = useState(() => signaturePrefs().lazyDelete);
  const { pasteSignatures } = store;
  const submit = useCallback(
    async (text: string) => {
      if (solarSystemId === null || !text.trim() || busy) return;
      setBusy(true);
      const result = await pasteSignatures(solarSystemId, { text, mode: replace ? 'replace' : 'merge' });
      setBusy(false);
      if (!result) return;
      toast({ ...pasteSummary(result), tone: 'success' });
      if (result.removedSignatures?.length) rememberRemoved(solarSystemId, result.removedSignatures);
      if (replace && !signaturePrefs().keepLazyDelete) setReplace(false);
    },
    [solarSystemId, busy, pasteSignatures, replace, toast],
  );
  return { busy, replace, setReplace, submit };
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

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

/** The current time, every second while something on screen counts. */
function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

const URGENCY_TEXT = { critical: 'Critical', warning: 'Soon', ok: '' } as const;

/** Resolved types and urgency of the map's connections, refreshed when they change. */
function useConnectionIntel(
  mapId: string,
  connections: Map<string, ConnectionDto>,
  signatures: SignatureDto[],
) {
  const stamp = useMemo(
    () =>
      [...connections.values()].reduce((max, c) => Math.max(max, c.updatedAt), 0) +
      signatures.reduce((max, s) => Math.max(max, s.updatedAt), 0),
    [connections, signatures],
  );
  const query = useQuery({
    queryKey: ['connection-intel', mapId, stamp],
    queryFn: () => api<ConnectionIntelDto[]>(buildPath(routes.connections.intel.path, { mapId })),
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
  return useMemo(() => new Map((query.data ?? []).map((i) => [i.connectionId, i])), [query.data]);
}

/** Time left in a hole, compact (`4h`, `35m`) or in words. */
function timeLeft(ms: number | null, words = false): string | null {
  if (ms === null) return null;
  const h = ms / 3_600_000;
  if (h < 1) {
    const m = Math.max(1, Math.round(h * 60));
    return words ? `${m} min left` : `${m}m`;
  }
  return words ? `about ${Math.round(h)} h left` : `${Math.round(h)}h`;
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
  /** Name of a system on the map (custom name or real name). */
  systemName?(solarSystemId: number): string;
}

/**
 * The signatures of the selected system, as in Wanderer's widget: columns and groups to taste,
 * any column sortable, new rows highlighted, ages ticking. Click selects (Ctrl/⌘ adds, Shift
 * takes a range), Ctrl/⌘+A selects all, Delete removes, Ctrl/⌘+Z puts removals back, a double
 * click (or the pencil) opens the editor, the link button says where a wormhole leads.
 */
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
  systemName = (id) => universe.get(id)?.name ?? String(id),
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

  const prefs = useSignaturePrefs();
  const now = useNow();
  const intel = useConnectionIntel(mapId, connections, signatures);
  const removal = useSignatureRemoval(mapId);
  const undo = useUndo(solarSystemId);
  const [picked, setSelected] = useState<Set<string>>(new Set());
  // Signatures that went away are no longer selected.
  const selected = useMemo(() => {
    const ids = new Set(signatures.map((s) => s.id));
    return new Set([...picked].filter((id) => ids.has(id)));
  }, [picked, signatures]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => visibleSignatures(signatures, prefs), [signatures, prefs]);
  const hidden = signatures.length - rows.length;
  const live = new Set(signatures.map((s) => s.eveId));
  const ghosts = undo.batches
    .flatMap((b) => b.signatures)
    .filter((s) => s.solarSystemId === solarSystemId && !live.has(s.eveId));
  const editingSig = editing ? signatures.find((s) => s.id === editing) : undefined;

  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    void paste.submit(e.clipboardData.getData('text/plain'));
  };

  const removeSelected = (ids: string[]) => {
    if (!can.edit || ids.length === 0) return;
    setSelected(new Set());
    void removal.remove(solarSystemId, ids);
  };

  const select = (e: MouseEvent, id: string) => {
    if (e.shiftKey && anchor) {
      const order = rows.map((r) => r.id);
      const [a = -1, b = -1] = [order.indexOf(anchor), order.indexOf(id)].sort((x, y) => x - y);
      if (a >= 0 && b >= 0) {
        setSelected(new Set(order.slice(a, b + 1)));
        return;
      }
    }
    setAnchor(id);
    if (e.metaKey || e.ctrlKey) {
      setSelected((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      });
    } else setSelected((current) => (current.size === 1 && current.has(id) ? new Set() : new Set([id])));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelected(new Set(rows.map((r) => r.id)));
    } else if (mod && e.key.toLowerCase() === 'z' && undo.batches.length > 0) {
      e.preventDefault();
      void removal.restore(undo.batches);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size > 0 && can.edit) {
      e.preventDefault();
      removeSelected([...selected]);
    } else if (e.key === 'Enter' && selected.size === 1 && can.edit) {
      e.preventDefault();
      setEditing([...selected][0]!);
    } else if (e.key === 'Escape' && selected.size > 0) {
      setSelected(new Set());
    }
  };

  const sortBy = (field: SignatureSortField) => {
    const { sort } = signaturePrefs();
    setSignaturePrefs({
      sort: {
        field,
        dir:
          sort.field === field
            ? sort.dir === 'asc'
              ? 'desc'
              : 'asc'
            : field === 'added' || field === 'updated'
              ? 'desc'
              : 'asc',
      },
    });
  };
  const header = (field: SignatureSortField, label: string, className?: string) => {
    const active = prefs.sort.field === field;
    return (
      <th
        scope="col"
        className={className}
        aria-sort={active ? (prefs.sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      >
        <button type="button" className={sig.sortButton} onClick={() => sortBy(field)}>
          {label}
          {active && (prefs.sort.dir === 'asc' ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden />)}
        </button>
      </th>
    );
  };

  const { columns } = prefs;
  const columnCount = 2 + Object.values(columns).filter(Boolean).length + (can.edit ? 1 : 0);
  const update = (id: string, patch: UpdateSignatureRequest) => store.updateSignature(id, patch);

  return (
    <div
      ref={rootRef}
      className={styles.signatures}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-color={prefs.colorByGroup || undefined}
    >
      {can.edit && (
        <div className={styles.pasteRow}>
          <label className={styles.pasteZone} data-busy={paste.busy || undefined}>
            <ClipboardPaste aria-hidden />
            <span>
              <Kbd>{MOD}</Kbd> <Kbd>V</Kbd> pastes the scan
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

      {undo.batches.length > 0 && (
        <div className={sig.undoBar} role="status">
          <span>
            {ghosts.length} removed · {undo.secondsLeft}s to undo
          </span>
          <Button
            size="sm"
            variant="secondary"
            icon={<Undo2 />}
            onClick={() => void removal.restore(undo.batches)}
          >
            Undo <Kbd>{MOD}</Kbd>
            <Kbd>Z</Kbd>
          </Button>
        </div>
      )}

      {selected.size > 1 && can.edit && (
        <div className={sig.selectionBar}>
          <span>{selected.size} selected</span>
          <Button size="sm" variant="danger-ghost" icon={<X />} onClick={() => removeSelected([...selected])}>
            Remove
          </Button>
        </div>
      )}

      {rows.length === 0 && ghosts.length === 0 ? (
        listed.isLoading ? (
          <div className={styles.padded} aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={14} width={`${90 - i * 15}%`} style={{ marginBottom: 10 }} />
            ))}
          </div>
        ) : (
          <p className={styles.empty}>
            <Radar aria-hidden />
            {hidden > 0
              ? `${hidden} hidden by the group filter.`
              : can.edit
                ? 'No signatures yet. Copy the probe scanner and paste.'
                : 'Nobody has scanned here yet.'}
          </p>
        )
      ) : (
        <table
          className={`${styles.table} ${sig.table}`}
          data-edit={can.edit || undefined}
          aria-multiselectable={can.edit || undefined}
        >
          <thead>
            <tr>
              {header('eveId', 'ID', sig.colId)}
              {columns.group && header('group', 'Group', sig.colGroup)}
              {header('info', 'Info')}
              {columns.description && header('description', 'Notes')}
              {columns.added && header('added', 'Added', `${styles.num} ${sig.colAge}`)}
              {columns.updated && header('updated', 'Upd.', `${styles.num} ${sig.colAge}`)}
              {columns.author && header('author', 'By', sig.colAuthor)}
              {can.edit && <th aria-label="Actions" className={sig.colActions} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const target = targetOf(s, connections);
              const connection = s.connectionId ? connections.get(s.connectionId) : undefined;
              const info = s.connectionId ? intel.get(s.connectionId) : undefined;
              const wormhole = s.group === 'wormhole';
              const time = connection?.timeStatus ?? s.timeStatus;
              const mass = connection?.massStatus ?? s.massStatus;
              const code = s.type?.toUpperCase();
              const resolved =
                info?.wormholeType && (!code || code === 'K162') && info.wormholeType !== code
                  ? info.wormholeType
                  : null;
              const isSelected = selected.has(s.id);
              return (
                <tr
                  key={s.id}
                  data-group={s.group}
                  data-selected={isSelected || undefined}
                  data-bubbled={s.bubbled || undefined}
                  aria-selected={can.edit ? isSelected : undefined}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('button, a, input')) return;
                    select(e, s.id);
                    rootRef.current?.focus({ preventScroll: true });
                  }}
                  onDoubleClick={(e) => {
                    if (!can.edit || (e.target as HTMLElement).closest('button, a')) return;
                    setEditing(s.id);
                  }}
                >
                  <td className={styles.sigId}>{s.eveId}</td>
                  {columns.group && <td className={sig.group}>{GROUP_LABEL[s.group]}</td>}
                  <td>
                    <span className={sig.info}>
                      {s.tempName && <strong className={sig.tempName}>{s.tempName}</strong>}
                      {wormhole && time === 'eol' && (
                        <Clock className={sig.iconEol} aria-label="End of life" />
                      )}
                      {wormhole && mass && mass !== 'fresh' && (
                        <TriangleAlert
                          className={mass === 'critical' ? sig.iconCritical : sig.iconReduced}
                          aria-label={mass === 'critical' ? 'Mass critical' : 'Mass reduced'}
                        />
                      )}
                      {s.bubbled && (
                        <CircleDot className={sig.iconBubble} aria-label="Hole is inside a bubble" />
                      )}
                      {wormhole ? (
                        code ? (
                          <TypeLabel code={code} destination={target === null ? s.destination : null} />
                        ) : (
                          !resolved && <span className="subtle">?</span>
                        )
                      ) : (
                        <span className={`${styles.ellipsis} ${sig.grow}`}>
                          {s.name ?? <span className="subtle">—</span>}
                        </span>
                      )}
                      {resolved && (
                        <span className={sig.resolved} title="Type from the other side of the hole">
                          ({resolved})
                        </span>
                      )}
                      {info && info.urgency !== 'ok' && (
                        <span
                          className={sig.urgency}
                          data-urgency={info.urgency}
                          title={[URGENCY_TEXT[info.urgency], timeLeft(info.time.remainingMs, true)]
                            .filter(Boolean)
                            .join(': ')}
                        >
                          {timeLeft(info.time.remainingMs) ?? URGENCY_TEXT[info.urgency]}
                        </span>
                      )}
                      {target !== null && (
                        <button
                          type="button"
                          className={`${styles.target} ${sig.grow}`}
                          title={`Leads to ${systemName(target)}: select it`}
                          onClick={() => onSelectSystem(target)}
                        >
                          <span aria-hidden>→ </span>
                          {systemName(target)}
                        </button>
                      )}
                      {s.description && !columns.description && (
                        <span
                          className={sig.iconNote}
                          role="img"
                          aria-label="Has notes"
                          title={s.description}
                        >
                          <MessageSquareText aria-hidden />
                        </span>
                      )}
                    </span>
                  </td>
                  {columns.description && (
                    <td
                      className={`${styles.ellipsis} ${sig.description}`}
                      title={s.description || undefined}
                    >
                      {s.description}
                    </td>
                  )}
                  {columns.added && (
                    <td
                      className={`${styles.num} ${styles.age}`}
                      data-fresh={freshness(s.createdAt, now)}
                      title={new Date(s.createdAt).toLocaleString()}
                    >
                      {ageLabel(s.createdAt, now)}
                    </td>
                  )}
                  {columns.updated && (
                    <td
                      className={`${styles.num} ${styles.age}`}
                      title={new Date(s.updatedAt).toLocaleString()}
                    >
                      {ageLabel(s.updatedAt, now)}
                    </td>
                  )}
                  {columns.author && (
                    <td className={sig.author} title={s.createdBy?.name}>
                      {s.createdBy?.characterId ? (
                        <CharacterAvatar
                          id={s.createdBy.characterId}
                          name={s.createdBy.name}
                          size={16}
                          decorative
                        />
                      ) : null}
                      <span className={styles.ellipsis}>{s.createdBy?.name ?? '—'}</span>
                    </td>
                  )}
                  {can.edit && (
                    <td className={styles.actionCell}>
                      <span className={sig.actions}>
                        {wormhole && target === null && (
                          <LeadsToMenu
                            signature={s}
                            connections={connections}
                            universe={universe}
                            systemName={systemName}
                            linkedTo={target}
                            onLink={(connectionId) => void update(s.id, { connectionId })}
                          />
                        )}
                        <IconButton
                          size="sm"
                          tooltip={false}
                          className={styles.rowRemove}
                          label={`Edit ${s.eveId}`}
                          icon={<Pencil />}
                          onClick={() => setEditing(s.id)}
                        />
                        <IconButton
                          size="sm"
                          tooltip={false}
                          className={styles.rowRemove}
                          label={`Remove ${s.eveId}`}
                          icon={<X />}
                          onClick={() => removeSelected(selected.has(s.id) ? [...selected] : [s.id])}
                        />
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
            {ghosts.map((s) => (
              <tr key={`ghost:${s.id}`} data-removed>
                <td className={styles.sigId}>{s.eveId}</td>
                <td colSpan={columnCount - 1} className={sig.ghost}>
                  removed{s.type ? ` · ${s.type}` : s.name ? ` · ${s.name}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hidden > 0 && rows.length > 0 && <p className={sig.hiddenNote}>{hidden} hidden by the group filter</p>}

      {editingSig && (
        <SignatureEditor
          signature={editingSig}
          system={universe.get(solarSystemId)}
          connections={connections}
          universe={universe}
          systemName={systemName}
          onSave={(patch) => update(editingSig.id, patch)}
          onClose={() => {
            setEditing(null);
            rootRef.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </div>
  );
}
