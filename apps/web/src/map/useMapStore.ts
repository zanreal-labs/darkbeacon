import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ACTION_HEADER,
  buildPath,
  routes,
  type ConnectionDto,
  type MapSystemDto,
  type PasteSignaturesRequest,
  type PasteSignaturesResult,
  type Position,
  type StreamSnapshotDto,
  type TypedEvent,
  type UpdateConnectionRequest,
  type UpdateSignatureRequest,
  type UpdateSystemRequest,
} from '@darkbeacon/shared';
import { api, ApiError } from '../lib/api';
import { useStream } from '../lib/RealtimeProvider';
import { applyMapMessage, emptyMapState, type MapState } from './mapState';
import { confirmPending, dropPending, settlePending, withPending, type PendingChange } from './optimistic';
import { connectionChangeLabel, count, systemChangeLabel } from './undo/labels';
import { newActionId, undoAction, UndoStack } from './undo/undoStack';

/** Reads the map's snapshot again over REST and shows it. */
async function reloadSnapshot(mapId: string, set: (update: (s: MapState) => MapState) => void) {
  const stream = `map:${mapId}`;
  try {
    const snapshot = await api<StreamSnapshotDto>(buildPath(routes.realtime.snapshot.path, { stream }));
    set((s) => applyMapMessage(s, { op: 'snapshot', stream, seq: snapshot.seq, data: snapshot.data }));
  } catch {
    // The stream's next snapshot (reconnect) brings it.
  }
}

/** How long a successful change waits for its event before the overlay is dropped anyway. */
const CONFIRM_GRACE_MS = 5_000;
const NOTICE_MS = 6_000;

export interface Notice {
  id: number;
  message: string;
}

/** Undoes a gesture once its request is through; refused when it never went through. */
async function undoWhenSent(sent: Promise<unknown>, mapId: string, action: string) {
  try {
    await sent;
  } catch {
    return { ok: false as const, reason: 'It never went through' };
  }
  return undoAction(mapId, action);
}

/**
 * One gesture that sends several requests (a bulk change of a selection, a paste): they share
 * one action id and are undone together. Made by `store.gesture`.
 */
export interface Gesture {
  readonly action: string;
  /** Some request of it went through: it is worth undoing. */
  succeeded: boolean;
}

interface ChangeSpec {
  apply(state: MapState): MapState;
  confirmedBy(event: TypedEvent): boolean;
  request(headers: Record<string, string>): Promise<unknown>;
  failure: string;
  /** A gesture of its own with this label (pushed on the undo stack), or part of a larger one. */
  undo?: string | Gesture;
}

export interface MapStoreOptions {
  /** A system's display name, for the undo labels ("Removed J123456"). */
  nameOf?(solarSystemId: number): string;
}

function mapWith<K, V>(map: Map<K, V>, key: K, update: (v: V) => V): Map<K, V> {
  const current = map.get(key);
  return current === undefined ? map : new Map(map).set(key, update(current));
}

function mapWithout<K, V>(map: Map<K, V>, keep: (v: V, k: K) => boolean): Map<K, V> {
  return new Map([...map].filter(([k, v]) => keep(v, k)));
}

/** Where a new system goes: a spot the viewer chose, or what the server places it by. */
export type SystemPlacement =
  | { position: Position; near?: undefined; around?: undefined }
  | { position?: undefined; near: number; around?: undefined }
  | { position?: undefined; near?: undefined; around: Position };

/**
 * Live state of one map: the `map:<id>` stream plus optimistic local changes. Commands go
 * over REST; their results come back as events, which replace the optimistic overlay.
 *
 * `initial` is the snapshot the server rendered the page with: the map shows at once and the
 * stream resumes after its seq, so nothing is loaded twice.
 */
export function useMapStore(mapId: string, initial?: StreamSnapshotDto, options: MapStoreOptions = {}) {
  const [confirmed, setConfirmed] = useState(() =>
    initial
      ? applyMapMessage(emptyMapState(), {
          op: 'snapshot',
          stream: initial.stream,
          seq: initial.seq,
          data: initial.data,
        })
      : emptyMapState(),
  );
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loaded, setLoaded] = useState(initial !== undefined);
  const [streamError, setStreamError] = useState<string | null>(null);
  const nextId = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  // The tab's undo stack lives as long as the map view.
  const [undoStack] = useState(() => new UndoStack());
  const undoEntries = useSyncExternalStore(undoStack.subscribe, undoStack.getSnapshot, undoStack.getSnapshot);
  const names = useRef(options.nameOf);
  useEffect(() => {
    names.current = options.nameOf;
  });

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach(clearTimeout);
  }, []);

  const later = useCallback((ms: number, fn: () => void) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      fn();
    }, ms);
    timers.current.add(timer);
  }, []);

  const notify = useCallback(
    (message: string) => {
      const id = ++nextId.current;
      setNotices((n) => [...n, { id, message }]);
      later(NOTICE_MS, () => setNotices((n) => n.filter((x) => x.id !== id)));
    },
    [later],
  );

  const trashed = useRef(false);
  useStream(
    `map:${mapId}`,
    (message) => {
      if (message.op === 'error') {
        // After a deletion the server drops the stream; the deletion says it better.
        if (!trashed.current) setStreamError(message.message);
        return;
      }
      if (message.op === 'event' && message.event.type === 'map.trashed') {
        trashed.current = true;
        setStreamError('This map was deleted. An instance admin can restore it.');
        return;
      }
      setStreamError(null);
      setConfirmed((s) => applyMapMessage(s, message));
      if (message.op === 'snapshot') {
        setLoaded(true);
        // The snapshot already contains everything that succeeded.
        setPending((p) => p.filter((c) => !c.settled));
      } else if (message.op === 'subscribed') {
        setLoaded(true);
      } else if (message.op === 'event') {
        const event = message.event as TypedEvent;
        setPending((p) => confirmPending(p, event));
        // The map started or stopped merging others: what it shows is a different set of objects.
        if (event.type === 'map.sources_changed') void reloadSnapshot(mapId, setConfirmed);
      }
    },
    initial?.seq,
  );

  const run = useCallback(
    async (spec: ChangeSpec): Promise<boolean> => {
      const id = ++nextId.current;
      const change: PendingChange = {
        id,
        apply: spec.apply,
        confirmedBy: spec.confirmedBy,
        settled: false,
        confirmed: false,
      };
      setPending((p) => [...p, change]);
      const gesture: Gesture | null =
        typeof spec.undo === 'string' ? { action: newActionId(), succeeded: false } : (spec.undo ?? null);
      const sent = spec.request(gesture ? { [ACTION_HEADER]: gesture.action } : {});
      // On the stack at once, so Ctrl+Z right after a change undoes it (once it went through).
      const entry =
        gesture && typeof spec.undo === 'string'
          ? undoStack.push({ label: spec.undo, undo: () => undoWhenSent(sent, mapId, gesture.action) })
          : null;
      try {
        await sent;
        if (gesture) gesture.succeeded = true;
        setPending((p) => settlePending(p, id));
        later(CONFIRM_GRACE_MS, () => setPending((p) => dropPending(p, id)));
        return true;
      } catch (error) {
        if (entry !== null) undoStack.forget(entry);
        setPending((p) => dropPending(p, id));
        notify(`${spec.failure}: ${error instanceof ApiError ? error.message : 'network error'}`);
        return false;
      }
    },
    [later, notify, undoStack, mapId],
  );

  const state = useMemo(() => withPending(confirmed, pending), [confirmed, pending]);
  // Commands read the latest state for their undo labels without being rebuilt on every event.
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });

  const commands = useMemo(() => {
    const nameOf = (id: number) => names.current?.(id) ?? String(id);
    const ends = (a: number, b: number) => `${nameOf(a)} – ${nameOf(b)}`;
    const isSystemEvent = (types: string[], ids: number[]) => (e: TypedEvent) =>
      types.includes(e.type) &&
      'solarSystemId' in e.data &&
      typeof e.data.solarSystemId === 'number' &&
      ids.includes(e.data.solarSystemId);

    return {
      /**
       * Adds a system: at `position` when the viewer chose the spot, else the server places it by
       * the map's placement rule next to `near` or as near `around` as it is free, and the map
       * shows it once the server says where.
       */
      addSystem(solarSystemId: number, placement: SystemPlacement, gesture?: Gesture) {
        const now = Date.now();
        const { position } = placement;
        const placeholder: MapSystemDto | null = position
          ? {
              mapId,
              solarSystemId,
              position,
              customName: null,
              temporaryName: null,
              tag: null,
              status: 'unknown',
              description: '',
              labelIds: [],
              systemLabelIds: [],
              customLabel: null,
              locked: false,
              visible: true,
              createdAt: now,
              updatedAt: now,
            }
          : null;
        return run({
          apply: (s) =>
            !placeholder || s.systems.has(solarSystemId)
              ? s
              : { ...s, systems: new Map(s.systems).set(solarSystemId, placeholder) },
          confirmedBy: isSystemEvent(['system.added', 'system.updated'], [solarSystemId]),
          request: (headers) =>
            api(buildPath(routes.systems.add.path, { mapId }), {
              method: 'POST',
              json: { solarSystemId, ...placement },
              headers,
            }),
          failure: 'Could not add the system',
          undo: gesture ?? `Added ${nameOf(solarSystemId)}`,
        });
      },

      updateSystem(solarSystemId: number, patch: UpdateSystemRequest, gesture?: Gesture) {
        return run({
          apply: (s) => ({
            ...s,
            systems: mapWith(s.systems, solarSystemId, (sys) => ({ ...sys, ...patch })),
          }),
          confirmedBy: isSystemEvent(['system.updated'], [solarSystemId]),
          request: (headers) =>
            api(buildPath(routes.systems.update.path, { mapId, solarSystemId }), {
              method: 'PATCH',
              json: patch,
              headers,
            }),
          failure: 'Could not update the system',
          undo: gesture ?? systemChangeLabel(nameOf(solarSystemId), patch),
        });
      },

      moveSystems(positions: { solarSystemId: number; x: number; y: number }[], gesture?: Gesture) {
        if (positions.length === 0) return Promise.resolve(true);
        const byId = new Map(positions.map((p) => [p.solarSystemId, p]));
        return run({
          apply: (s) => {
            const systems = new Map(s.systems);
            for (const [id, p] of byId) {
              const sys = systems.get(id);
              if (sys) systems.set(id, { ...sys, position: { x: p.x, y: p.y } });
            }
            return { ...s, systems };
          },
          confirmedBy: isSystemEvent(['system.updated'], [...byId.keys()]),
          request: (headers) =>
            api(buildPath(routes.systems.move.path, { mapId }), {
              method: 'POST',
              json: { positions },
              headers,
            }),
          failure: 'Could not move the systems',
          undo:
            gesture ??
            (positions.length === 1
              ? `Moved ${nameOf(positions[0]!.solarSystemId)}`
              : `Moved ${count(positions.length, 'system')}`),
        });
      },

      removeSystem(solarSystemId: number, gesture?: Gesture) {
        return run({
          apply: (s) => ({
            ...s,
            systems: mapWithout(s.systems, (_, id) => id !== solarSystemId),
            connections: mapWithout(
              s.connections,
              (c) => c.source !== solarSystemId && c.target !== solarSystemId,
            ),
          }),
          confirmedBy: isSystemEvent(['system.removed'], [solarSystemId]),
          request: (headers) =>
            api(buildPath(routes.systems.remove.path, { mapId, solarSystemId }), {
              method: 'DELETE',
              headers,
            }),
          failure: 'Could not remove the system',
          undo: gesture ?? `Removed ${nameOf(solarSystemId)}`,
        });
      },

      addConnection(source: number, target: number, gesture?: Gesture) {
        const now = Date.now();
        const id = `pending:${source}:${target}`;
        const placeholder: ConnectionDto = {
          id,
          mapId,
          source,
          target,
          type: 'wormhole',
          timeStatus: 'normal',
          massStatus: 'fresh',
          shipSize: 'large',
          massSaved: false,
          dangerous: false,
          bubbled: 'none',
          eolAt: null,
          createdAt: now,
          updatedAt: now,
        };
        const joins = (c: { source: number; target: number }) =>
          (c.source === source && c.target === target) || (c.source === target && c.target === source);
        return run({
          apply: (s) =>
            [...s.connections.values()].some(joins)
              ? s
              : { ...s, connections: new Map(s.connections).set(id, placeholder) },
          confirmedBy: (e) => e.type === 'connection.added' && joins(e.data),
          request: (headers) =>
            api(buildPath(routes.connections.add.path, { mapId }), {
              method: 'POST',
              json: { source, target },
              headers,
            }),
          failure: 'Could not connect the systems',
          undo: gesture ?? `Connected ${nameOf(source)} and ${nameOf(target)}`,
        });
      },

      updateConnection(connectionId: string, patch: UpdateConnectionRequest, gesture?: Gesture) {
        const known = latest.current.connections.get(connectionId);
        return run({
          apply: (s) => ({
            ...s,
            connections: mapWith(s.connections, connectionId, (c) => {
              // A lifetime mark is sent by name; the connection holds it with the time it was set.
              const { lifetime, ...rest } = patch;
              const next: ConnectionDto = { ...c, ...rest };
              if (lifetime !== undefined)
                next.lifetime = lifetime === null ? null : { mark: lifetime, at: Date.now() };
              return next;
            }),
          }),
          confirmedBy: (e) => e.type === 'connection.updated' && e.data.id === connectionId,
          request: (headers) =>
            api(buildPath(routes.connections.update.path, { mapId, connectionId }), {
              method: 'PATCH',
              json: patch,
              headers,
            }),
          failure: 'Could not update the connection',
          undo:
            gesture ??
            connectionChangeLabel(known ? ends(known.source, known.target) : 'a connection', patch),
        });
      },

      /** `withSignatures`: the signatures leading through it go too. */
      removeConnection(connectionId: string, options: { withSignatures?: boolean } = {}, gesture?: Gesture) {
        const query = options.withSignatures ? '?withSignatures=true' : '';
        const known = latest.current.connections.get(connectionId);
        return run({
          apply: (s) => ({ ...s, connections: mapWithout(s.connections, (_, id) => id !== connectionId) }),
          confirmedBy: (e) => e.type === 'connection.removed' && e.data.id === connectionId,
          request: (headers) =>
            api(`${buildPath(routes.connections.remove.path, { mapId, connectionId })}${query}`, {
              method: 'DELETE',
              headers,
            }),
          failure: 'Could not remove the connection',
          undo:
            gesture ??
            (known ? `Removed the connection ${ends(known.source, known.target)}` : 'Removed a connection'),
        });
      },

      updateSignature(signatureId: string, patch: UpdateSignatureRequest, gesture?: Gesture) {
        const known = latest.current.signatures.get(signatureId);
        return run({
          apply: (s) => ({
            ...s,
            signatures: mapWith(s.signatures, signatureId, (sig) => ({ ...sig, ...patch })),
          }),
          confirmedBy: (e) => e.type === 'signature.updated' && e.data.id === signatureId,
          request: (headers) =>
            api(buildPath(routes.signatures.update.path, { mapId, signatureId }), {
              method: 'PATCH',
              json: patch,
              headers,
            }),
          failure: 'Could not update the signature',
          undo: gesture ?? (known ? `Changed signature ${known.eveId}` : 'Changed a signature'),
        });
      },

      removeSignature(signatureId: string, gesture?: Gesture) {
        const known = latest.current.signatures.get(signatureId);
        return run({
          apply: (s) => ({ ...s, signatures: mapWithout(s.signatures, (_, id) => id !== signatureId) }),
          confirmedBy: (e) => e.type === 'signature.removed' && e.data.id === signatureId,
          request: (headers) =>
            api(buildPath(routes.signatures.remove.path, { mapId, signatureId }), {
              method: 'DELETE',
              headers,
            }),
          failure: 'Could not remove the signature',
          undo: gesture ?? (known ? `Removed signature ${known.eveId}` : 'Removed a signature'),
        });
      },

      /** Not optimistic: the server parses the scanner text; the signatures arrive as events. */
      async pasteSignatures(
        solarSystemId: number,
        request: PasteSignaturesRequest,
      ): Promise<PasteSignaturesResult | null> {
        const action = newActionId();
        try {
          const result = await api<PasteSignaturesResult>(
            buildPath(routes.signatures.paste.path, { mapId, solarSystemId }),
            { method: 'POST', json: request, headers: { [ACTION_HEADER]: action } },
          );
          undoStack.push({
            label: `Pasted signatures in ${nameOf(solarSystemId)}`,
            undo: () => undoAction(mapId, action),
          });
          return result;
        } catch (error) {
          notify(
            `Could not read the signatures: ${error instanceof ApiError ? error.message : 'network error'}`,
          );
          return null;
        }
      },

      /**
       * Removes several systems and connections in one request (Delete on a selection): one
       * transaction, one gesture to undo.
       */
      removeMany(selection: { systems: number[]; connections: string[] }, label: string) {
        const systems = new Set(selection.systems);
        const connections = new Set(selection.connections);
        if (systems.size + connections.size === 0) return Promise.resolve(true);
        return run({
          apply: (s) => ({
            ...s,
            systems: mapWithout(s.systems, (_, id) => !systems.has(id)),
            connections: mapWithout(
              s.connections,
              (c, id) => !connections.has(id) && !systems.has(c.source) && !systems.has(c.target),
            ),
          }),
          confirmedBy: (e) =>
            (e.type === 'system.removed' && systems.has(e.data.solarSystemId)) ||
            (e.type === 'connection.removed' && connections.has(e.data.id)),
          request: (headers) =>
            api(buildPath(routes.mapApi.batchDelete.path, { mapId }), {
              method: 'POST',
              json: { systems: [...systems], connections: [...connections] },
              headers,
            }),
          failure: 'Could not remove the selection',
          undo: label,
        });
      },

      /** The same change to several systems in one request (a status for a selection). */
      updateMany(patches: Array<{ solarSystemId: number; patch: UpdateSystemRequest }>, label: string) {
        if (patches.length === 0) return Promise.resolve(true);
        const byId = new Map(patches.map((p) => [p.solarSystemId, p.patch]));
        return run({
          apply: (s) => {
            const next = new Map(s.systems);
            for (const [id, patch] of byId) {
              const sys = next.get(id);
              if (sys) next.set(id, { ...sys, ...patch });
            }
            return { ...s, systems: next };
          },
          confirmedBy: isSystemEvent(['system.updated'], [...byId.keys()]),
          request: (headers) =>
            api(buildPath(routes.mapApi.batchUpsert.path, { mapId }), {
              method: 'POST',
              json: { systems: patches.map((p) => ({ solarSystemId: p.solarSystemId, ...p.patch })) },
              headers,
            }),
          failure: 'Could not change the systems',
          undo: label,
        });
      },

      /**
       * Runs a gesture of several requests (each command given the `Gesture`); it goes on the undo
       * stack as one entry when any of them went through.
       */
      async gesture<T>(label: string, work: (gesture: Gesture) => Promise<T>): Promise<T> {
        const gesture: Gesture = { action: newActionId(), succeeded: false };
        const done = work(gesture);
        const entry = undoStack.push({
          label,
          undo: async () => {
            await done.catch(() => undefined);
            return gesture.succeeded
              ? undoAction(mapId, gesture.action)
              : { ok: false, reason: 'None of it went through' };
          },
        });
        try {
          return await done;
        } finally {
          if (!gesture.succeeded) undoStack.forget(entry);
        }
      },

      /** Undoes the newest gesture of this tab (Ctrl+Z); null when there is none. */
      undo: () => undoStack.undo(),

      /** Something else that can be taken back joins the same stack (removed signatures). */
      pushUndo: (entry: Parameters<UndoStack['push']>[0]) => undoStack.push(entry),
      forgetUndo: (id: number) => undoStack.forget(id),

      /** Merges data loaded over REST for a part the snapshot did not carry. */
      seed(update: (state: MapState) => MapState) {
        setConfirmed(update);
      },

      dismiss(noticeId: number) {
        setNotices((n) => n.filter((x) => x.id !== noticeId));
      },
    };
  }, [mapId, run, notify, undoStack]);

  return {
    state,
    loaded,
    notices,
    streamError,
    pendingCount: pending.length,
    /** The label of the gesture Ctrl+Z would undo; null when there is none. */
    undoLabel: undoEntries.at(-1)?.label ?? null,
    ...commands,
  };
}

export type MapStore = ReturnType<typeof useMapStore>;
