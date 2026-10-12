import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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

interface ChangeSpec {
  apply(state: MapState): MapState;
  confirmedBy(event: TypedEvent): boolean;
  request(): Promise<unknown>;
  failure: string;
}

function mapWith<K, V>(map: Map<K, V>, key: K, update: (v: V) => V): Map<K, V> {
  const current = map.get(key);
  return current === undefined ? map : new Map(map).set(key, update(current));
}

function mapWithout<K, V>(map: Map<K, V>, keep: (v: V, k: K) => boolean): Map<K, V> {
  return new Map([...map].filter(([k, v]) => keep(v, k)));
}

/**
 * Live state of one map: the `map:<id>` stream plus optimistic local changes. Commands go
 * over REST; their results come back as events, which replace the optimistic overlay.
 *
 * `initial` is the snapshot the server rendered the page with: the map shows at once and the
 * stream resumes after its seq, so nothing is loaded twice.
 */
export function useMapStore(mapId: string, initial?: StreamSnapshotDto) {
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
      try {
        await spec.request();
        setPending((p) => settlePending(p, id));
        later(CONFIRM_GRACE_MS, () => setPending((p) => dropPending(p, id)));
        return true;
      } catch (error) {
        setPending((p) => dropPending(p, id));
        notify(`${spec.failure}: ${error instanceof ApiError ? error.message : 'network error'}`);
        return false;
      }
    },
    [later, notify],
  );

  const state = useMemo(() => withPending(confirmed, pending), [confirmed, pending]);

  const commands = useMemo(() => {
    const isSystemEvent = (types: string[], ids: number[]) => (e: TypedEvent) =>
      types.includes(e.type) &&
      'solarSystemId' in e.data &&
      typeof e.data.solarSystemId === 'number' &&
      ids.includes(e.data.solarSystemId);

    return {
      addSystem(solarSystemId: number, position: Position) {
        const now = Date.now();
        const placeholder: MapSystemDto = {
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
        };
        return run({
          apply: (s) =>
            s.systems.has(solarSystemId)
              ? s
              : { ...s, systems: new Map(s.systems).set(solarSystemId, placeholder) },
          confirmedBy: isSystemEvent(['system.added', 'system.updated'], [solarSystemId]),
          request: () =>
            api(buildPath(routes.systems.add.path, { mapId }), {
              method: 'POST',
              json: { solarSystemId, position },
            }),
          failure: 'Could not add the system',
        });
      },

      updateSystem(solarSystemId: number, patch: UpdateSystemRequest) {
        return run({
          apply: (s) => ({
            ...s,
            systems: mapWith(s.systems, solarSystemId, (sys) => ({ ...sys, ...patch })),
          }),
          confirmedBy: isSystemEvent(['system.updated'], [solarSystemId]),
          request: () =>
            api(buildPath(routes.systems.update.path, { mapId, solarSystemId }), {
              method: 'PATCH',
              json: patch,
            }),
          failure: 'Could not update the system',
        });
      },

      moveSystems(positions: { solarSystemId: number; x: number; y: number }[]) {
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
          request: () =>
            api(buildPath(routes.systems.move.path, { mapId }), { method: 'POST', json: { positions } }),
          failure: 'Could not move the systems',
        });
      },

      removeSystem(solarSystemId: number) {
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
          request: () =>
            api(buildPath(routes.systems.remove.path, { mapId, solarSystemId }), { method: 'DELETE' }),
          failure: 'Could not remove the system',
        });
      },

      addConnection(source: number, target: number) {
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
          request: () =>
            api(buildPath(routes.connections.add.path, { mapId }), {
              method: 'POST',
              json: { source, target },
            }),
          failure: 'Could not connect the systems',
        });
      },

      updateConnection(connectionId: string, patch: UpdateConnectionRequest) {
        return run({
          apply: (s) => ({
            ...s,
            connections: mapWith(s.connections, connectionId, (c) => ({ ...c, ...patch })),
          }),
          confirmedBy: (e) => e.type === 'connection.updated' && e.data.id === connectionId,
          request: () =>
            api(buildPath(routes.connections.update.path, { mapId, connectionId }), {
              method: 'PATCH',
              json: patch,
            }),
          failure: 'Could not update the connection',
        });
      },

      removeConnection(connectionId: string) {
        return run({
          apply: (s) => ({ ...s, connections: mapWithout(s.connections, (_, id) => id !== connectionId) }),
          confirmedBy: (e) => e.type === 'connection.removed' && e.data.id === connectionId,
          request: () =>
            api(buildPath(routes.connections.remove.path, { mapId, connectionId }), { method: 'DELETE' }),
          failure: 'Could not remove the connection',
        });
      },

      updateSignature(signatureId: string, patch: UpdateSignatureRequest) {
        return run({
          apply: (s) => ({
            ...s,
            signatures: mapWith(s.signatures, signatureId, (sig) => ({ ...sig, ...patch })),
          }),
          confirmedBy: (e) => e.type === 'signature.updated' && e.data.id === signatureId,
          request: () =>
            api(buildPath(routes.signatures.update.path, { mapId, signatureId }), {
              method: 'PATCH',
              json: patch,
            }),
          failure: 'Could not update the signature',
        });
      },

      removeSignature(signatureId: string) {
        return run({
          apply: (s) => ({ ...s, signatures: mapWithout(s.signatures, (_, id) => id !== signatureId) }),
          confirmedBy: (e) => e.type === 'signature.removed' && e.data.id === signatureId,
          request: () =>
            api(buildPath(routes.signatures.remove.path, { mapId, signatureId }), { method: 'DELETE' }),
          failure: 'Could not remove the signature',
        });
      },

      /** Not optimistic: the server parses the scanner text; the signatures arrive as events. */
      async pasteSignatures(
        solarSystemId: number,
        request: PasteSignaturesRequest,
      ): Promise<PasteSignaturesResult | null> {
        try {
          return await api<PasteSignaturesResult>(
            buildPath(routes.signatures.paste.path, { mapId, solarSystemId }),
            { method: 'POST', json: request },
          );
        } catch (error) {
          notify(
            `Could not read the signatures: ${error instanceof ApiError ? error.message : 'network error'}`,
          );
          return null;
        }
      },

      /** Merges data loaded over REST for a part the snapshot did not carry. */
      seed(update: (state: MapState) => MapState) {
        setConfirmed(update);
      },

      dismiss(noticeId: number) {
        setNotices((n) => n.filter((x) => x.id !== noticeId));
      },
    };
  }, [mapId, run, notify]);

  return { state, loaded, notices, streamError, pendingCount: pending.length, ...commands };
}

export type MapStore = ReturnType<typeof useMapStore>;
