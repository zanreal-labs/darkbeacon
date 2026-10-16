'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PRESENCE_HZ,
  routes,
  type MapPoint,
  type PresenceDrag,
  type PresenceEditing,
  type PresencePeerDto,
  type PresencePeerPatch,
  type PresenceSettingsDto,
  type PresenceStatePatch,
  type UpdatePresenceSettingsRequest,
} from '@darkbeacon/shared';
import { api } from './api';
import type { PresenceMessage, RealtimeClient } from './realtime';
import { useRealtime } from './RealtimeProvider';
import { ActivityTracker, type ActivityReporter, type ActivityTimers } from './presence-activity';
import { presenceSettingsKey } from './session-keys';

const NO_PEERS: readonly PresencePeerDto[] = [];

/** One person on the map, with how many tabs they have open there. */
export interface PresentPerson {
  accountId: string;
  name: string;
  characterId: number | null;
  characterName: string | null;
  color: number;
  tabs: number;
  /** What one of their tabs has open for editing. */
  editing: PresenceEditing | null;
  since: number;
}

/**
 * Presence of the others on one map stream, and this tab's own, for one mounted view. Keeps the
 * peers (an immutable array per change, for useSyncExternalStore) and sends this tab's updates at
 * most PRESENCE_HZ times a second, latest state wins. Never stored: a reload starts empty.
 */
export class PresenceStore {
  private peers = new Map<string, PresencePeerDto>();
  private snapshot: readonly PresencePeerDto[] = NO_PEERS;
  private readonly listeners = new Set<() => void>();
  private pending: PresenceStatePatch | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSent = 0;
  private readonly cleanups: Array<() => void> = [];
  private readonly intervalMs: number;

  constructor(
    private readonly client: RealtimeClient,
    readonly stream: string,
    options: { hz?: number; now?: () => number } = {},
  ) {
    this.intervalMs = Math.round(1000 / (options.hz ?? PRESENCE_HZ));
    this.now = options.now ?? Date.now;
  }

  private readonly now: () => number;

  /** Joins the map: others see this tab, and this store starts receiving them. */
  start(initial: PresenceStatePatch = {}): void {
    // Presence rides on the map stream: the server only accepts it from sockets following it.
    this.cleanups.push(this.client.subscribe(this.stream, () => {}));
    this.cleanups.push(this.client.onPresence(this.stream, (message) => this.apply(message)));
    this.cleanups.push(
      this.client.onStatus((status) => {
        // Whoever was here may have left while the socket was down; the rejoin sends the list again.
        if (status === 'closed') this.replace([]);
      }),
    );
    this.client.sendPresence(this.stream, initial);
    this.lastSent = this.now();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.client.leavePresence(this.stream);
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.replace([]);
  }

  /** Shares a change; sent at once when the rate allows, else merged into the next send. */
  update(patch: PresenceStatePatch): void {
    this.pending = { ...this.pending, ...patch };
    if (this.timer) return;
    const wait = this.lastSent + this.intervalMs - this.now();
    if (wait <= 0) this.flush();
    else this.timer = setTimeout(() => this.flush(), wait);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly PresencePeerDto[] => this.snapshot;

  apply(message: PresenceMessage): void {
    if (message.full) {
      // A full list carries every peer whole.
      this.replace(message.peers as PresencePeerDto[]);
      return;
    }
    // Changes are patches: the key and what changed; someone new arrives whole.
    for (const patch of message.peers) {
      const known = this.peers.get(patch.key);
      if (known) this.peers.set(patch.key, { ...known, ...patch });
      else if (isWhole(patch)) this.peers.set(patch.key, patch);
    }
    for (const key of message.left) this.peers.delete(key);
    this.publish();
  }

  private flush(): void {
    this.timer = null;
    if (!this.pending) return;
    const patch = this.pending;
    this.pending = null;
    this.lastSent = this.now();
    this.client.sendPresence(this.stream, patch);
  }

  private replace(peers: readonly PresencePeerDto[]): void {
    if (peers.length === 0 && this.peers.size === 0) return;
    this.peers = new Map(peers.map((p) => [p.key, p]));
    this.publish();
  }

  private publish(): void {
    this.snapshot = [...this.peers.values()].sort((a, b) => a.since - b.since || a.key.localeCompare(b.key));
    for (const listener of this.listeners) listener();
  }
}

function isWhole(peer: PresencePeerPatch): peer is PresencePeerDto {
  return peer.accountId !== undefined && peer.since !== undefined && peer.color !== undefined;
}

/** Peers grouped per person (several tabs of one account read as one person). */
export function peopleOf(peers: readonly PresencePeerDto[]): PresentPerson[] {
  const people = new Map<string, PresentPerson>();
  for (const peer of peers) {
    const known = people.get(peer.accountId);
    if (known) {
      known.tabs += 1;
      known.editing ??= peer.editing;
      known.since = Math.min(known.since, peer.since);
      continue;
    }
    people.set(peer.accountId, {
      accountId: peer.accountId,
      name: peer.name,
      characterId: peer.characterId,
      characterName: peer.characterName,
      color: peer.color,
      tabs: 1,
      editing: peer.editing,
      since: peer.since,
    });
  }
  return [...people.values()].sort((a, b) => a.since - b.since);
}

/** Who else has `kind`/`id` open for editing (for markers on a system, connection or field). */
export function editorsOf(
  peers: readonly PresencePeerDto[],
  kind: PresenceEditing['kind'],
  id: string,
  field?: string,
): PresencePeerDto[] {
  return peers.filter(
    (p) =>
      p.editing?.kind === kind && p.editing.id === id && (field === undefined || p.editing.field === field),
  );
}

export interface PresencePublisher {
  /**
   * The pointer in map (flow) coordinates; null when it leaves the canvas. Remembered always,
   * shared only while this tab is changing something.
   */
  cursor(point: MapPoint | null): void;
  /** Systems being dragged and where they would land; null when the drag ends. */
  drag(drag: PresenceDrag | null): void;
  /** What this tab has open for editing; null when closed. */
  editing(editing: PresenceEditing | null): void;
  /** What this tab is actively changing: the others see its cursor only meanwhile. */
  activity: ActivityReporter;
}

/**
 * Shares this tab's cursor and drag preview only while it is changing something (and the grace
 * time after): moving the mouse, hovering or selecting sends nothing. The activity starting
 * sends where the pointer is; it ending clears the cursor for everyone. The store throttles.
 */
export class ActivePresence implements PresencePublisher {
  private pointer: MapPoint | null = null;
  private dragging: PresenceDrag | null = null;
  private readonly tracker: ActivityTracker;
  readonly activity: ActivityReporter;

  constructor(
    private readonly send: (patch: PresenceStatePatch) => void,
    options: { graceMs?: number; timers?: ActivityTimers } = {},
  ) {
    this.tracker = new ActivityTracker(
      (activity) =>
        this.send(
          activity
            ? { activity, cursor: this.pointer, drag: this.dragging }
            : { activity: null, cursor: null, drag: null },
        ),
      options,
    );
    this.activity = {
      begin: (token, activity) => this.tracker.begin(token, activity),
      end: (token) => this.tracker.end(token),
      pulse: (activity) => this.tracker.pulse(activity),
    };
  }

  cursor = (point: MapPoint | null): void => {
    this.pointer = point;
    if (this.tracker.active) this.send({ cursor: point });
  };

  drag = (drag: PresenceDrag | null): void => {
    this.dragging = drag;
    if (this.tracker.active) this.send({ drag });
  };

  editing = (editing: PresenceEditing | null): void => this.send({ editing });

  dispose(): void {
    this.tracker.dispose();
  }
}

export interface MapPresence {
  /** Everyone else, one entry per tab, oldest arrival first. */
  peers: readonly PresencePeerDto[];
  /** Everyone else, one entry per person. */
  people: PresentPerson[];
  publish: PresencePublisher;
}

const idlePublisher: PresencePublisher = {
  cursor: () => {},
  drag: () => {},
  editing: () => {},
  activity: { begin: () => {}, end: () => {}, pulse: () => {} },
};

/**
 * Presence on a map: joins while mounted (others see this tab), returns the others and stable
 * functions to share what this tab is changing, with its cursor and drag preview meanwhile.
 * `stream` is `map:<id>`; null while unknown. Respecting "show others" is the server's job.
 */
export function useMapPresence(stream: string | null): MapPresence {
  const client = useRealtime();
  // Made during render (it does nothing until started), started and stopped by the effect.
  const store = useMemo(() => (stream ? new PresenceStore(client, stream) : null), [client, stream]);
  const publish = useMemo(() => (store ? new ActivePresence((patch) => store.update(patch)) : null), [store]);
  useEffect(() => {
    if (!store) return;
    store.start();
    return () => {
      publish?.dispose();
      store.stop();
    };
  }, [store, publish]);
  const peers = useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store?.getSnapshot ?? emptyPeers,
    emptyPeers,
  );
  const people = useMemo(() => peopleOf(peers), [peers]);
  return { peers, people, publish: publish ?? idlePublisher };
}

const noopSubscribe = () => () => {};
const emptyPeers = () => NO_PEERS;

export { presenceSettingsKey };

/** "Share my cursor" and "show others", kept on the server per account. */
export function usePresenceSettings() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: presenceSettingsKey,
    queryFn: () => api<PresenceSettingsDto>(routes.presence.settings.path),
    staleTime: 60_000,
  });
  const update = useMutation({
    mutationFn: (patch: UpdatePresenceSettingsRequest) =>
      api<PresenceSettingsDto>(routes.presence.updateSettings.path, { method: 'PUT', json: patch }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: presenceSettingsKey });
      const previous = queryClient.getQueryData<PresenceSettingsDto>(presenceSettingsKey);
      if (previous) queryClient.setQueryData(presenceSettingsKey, { ...previous, ...patch });
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(presenceSettingsKey, context.previous);
    },
    onSuccess: (data) => queryClient.setQueryData(presenceSettingsKey, data),
  });
  return { settings, update };
}

/** Who is on the map this tab shows (the viewer included), for the top bar; null off a map. */
export interface MapPeople {
  count: number;
  /** The others' names, oldest arrival first. */
  others: string[];
}

let mapPeople: MapPeople | null = null;
const mapPeopleListeners = new Set<() => void>();

/** Set by the map view while it is mounted (one per tab). */
export function setMapPeople(people: MapPeople | null): void {
  if (
    mapPeople === people ||
    (mapPeople &&
      people &&
      mapPeople.count === people.count &&
      mapPeople.others.join('\n') === people.others.join('\n'))
  )
    return;
  mapPeople = people;
  for (const listener of mapPeopleListeners) listener();
}

export function useMapPeople(): MapPeople | null {
  return useSyncExternalStore(
    (listener) => {
      mapPeopleListeners.add(listener);
      return () => mapPeopleListeners.delete(listener);
    },
    () => mapPeople,
    () => null,
  );
}
