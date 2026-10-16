import {
  PRESENCE_COLORS,
  PRESENCE_HZ,
  PRESENCE_PEER_BUDGET,
  type PresenceEditing,
  type PresencePeerDto,
  type PresencePeerPatch,
  type PresenceSettingsDto,
  type PresenceState,
  type PresenceStatePatch,
  type ServerMessage,
} from '@darkbeacon/shared';

export type PresenceMessage = Extract<ServerMessage, { op: 'presence' }>;

/** Who a tab belongs to, shown to the others. */
export interface PresenceIdentity {
  accountId: string;
  name: string;
  characterId: number | null;
  characterName: string | null;
}

/** One tab on one map, as the hub hands it to the rooms. */
export interface PresenceMember {
  /** Stable per socket. */
  key: string;
  identity: PresenceIdentity;
  settings: PresenceSettingsDto;
  /** `text` is `message` serialized; transports send it as is. */
  send(message: PresenceMessage, text: string): void;
}

/** What a plugin may learn: who is on a map and what they have open; no cursors. */
export interface PresenceSummary {
  accountId: string;
  name: string;
  characterId: number | null;
  characterName: string | null;
  editing: PresenceEditing | null;
  since: number;
}

export const DEFAULT_PRESENCE_SETTINGS: PresenceSettingsDto = { shareCursor: true, showOthers: true };

/** One of a process's own peers on a map, as it tells the other processes (always whole). */
export interface RelayedPeer {
  key: string;
  identity: PresenceIdentity;
  shareCursor: boolean;
  since: number;
  state: PresenceState;
}

/** What one process tells the others about its peers on one map. */
export interface PresenceBroadcast {
  /** The process it comes from (its own broadcasts come back and are ignored). */
  from: string;
  stream: string;
  peers: RelayedPeer[];
  /** Its peers that left. */
  left: string[];
}

/**
 * Presence between the replicas of an instance: each one broadcasts its own peers' changes
 * (coalesced, at most once per flush) and hears the others'. Without a relay presence stays
 * within the process, which is all a single process needs.
 */
export interface PresenceRelay {
  publish(broadcast: PresenceBroadcast): void;
  subscribe(handler: (broadcast: PresenceBroadcast) => void): () => void;
}

/** Every process repeats its peers this often; a remote peer not heard of for 3 times as long is gone. */
export const RELAY_REFRESH_MS = 5_000;

const EMPTY_STATE: PresenceState = {
  cursor: null,
  drag: null,
  editing: null,
  selection: null,
  activity: null,
};
/** Fields kept and relayed. `selection` is accepted from older clients and ignored. */
const FIELDS = ['activity', 'cursor', 'drag', 'editing'] as const;
type Field = (typeof FIELDS)[number];
const MOTION: ReadonlySet<Field> = new Set(['cursor', 'drag']);

/** A peer shows its cursor and drag preview only while it is changing something. */
function active(state: PresenceState): boolean {
  return state.activity !== null;
}

/**
 * The relay filter: what of a peer's state leaves this process (to viewers and to the other
 * replicas). Idle peers have no cursor or drag; selections are never shared.
 */
export function sharedState(state: PresenceState): PresenceState {
  const moving = active(state);
  return {
    cursor: moving ? state.cursor : null,
    drag: moving ? state.drag : null,
    editing: state.editing,
    selection: null,
    activity: state.activity,
  };
}

interface Peer {
  member: PresenceMember;
  state: PresenceState;
  color: number;
  since: number;
  /** Fields changed since the last flush. */
  changed: Set<Field>;
  /** The others get this peer in full on the next flush (it joined, or its settings changed). */
  whole: boolean;
  /** On another process: when that process last told about it. Null for this process's peers. */
  remoteSeenAt: number | null;
}

interface Room {
  peers: Map<string, Peer>;
  /** Peers whose state changed since the last flush. */
  dirty: Set<string>;
  left: Set<string>;
  /** This process's peers that changed since the last broadcast. */
  relayDirty: Set<string>;
  /** This process's peers that left since the last broadcast. */
  leftLocal: Set<string>;
  /** Membership or editing markers changed: plugins hear about it. */
  summaryChanged: boolean;
  lastFlushAt: number;
}

/** A colour index per account (same colour on every tab and map). */
export function presenceColor(accountId: string): number {
  let hash = 0;
  for (let i = 0; i < accountId.length; i++) hash = (Math.imul(hash, 31) + accountId.charCodeAt(i)) >>> 0;
  return hash % PRESENCE_COLORS;
}

export interface PresenceRoomsOptions {
  /** Peak flushes per second of a map (default PRESENCE_HZ). */
  hz?: number;
  /**
   * Peer updates one viewer receives per second at most (default PRESENCE_PEER_BUDGET): a map
   * with many people moving is flushed less often, so nobody gets more than this.
   */
  peerBudget?: number;
  now?: () => number;
  /** Shares presence with the other replicas; none for a single process. */
  relay?: PresenceRelay;
  /** This process in relayed broadcasts. */
  processId?: string;
}

/** Slowest flush rate of a crowded map: 4 a second. */
const MAX_INTERVAL_MS = 250;

/**
 * Who is on which map and what they are doing there. In memory only, never stored and never on
 * the event log. Updates are merged per peer and sent at most `hz` times a second per map (less
 * on crowded maps, see `peerBudget`), so a busy map costs the same however fast clients send.
 * Changes go out as patches (key and the fields that changed); a peer that just joined or changed
 * its settings goes out whole. Each patch is serialized once per flush, not once per viewer.
 * With a relay, the peers of other replicas take part like this process's own.
 */
export class PresenceRooms {
  private readonly rooms = new Map<string, Room>();
  private readonly listeners = new Set<(stream: string, here: PresenceSummary[]) => void>();
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private readonly peerBudget: number;
  private readonly now: () => number;
  private readonly relay: PresenceRelay | undefined;
  private readonly processId: string;
  private readonly unsubscribeRelay: (() => void) | undefined;
  private lastRefreshAt = 0;

  constructor(options: PresenceRoomsOptions = {}) {
    this.intervalMs = Math.round(1000 / (options.hz ?? PRESENCE_HZ));
    this.peerBudget = options.peerBudget ?? PRESENCE_PEER_BUDGET;
    this.now = options.now ?? Date.now;
    this.relay = options.relay;
    this.processId = options.processId ?? crypto.randomUUID();
    this.unsubscribeRelay = this.relay?.subscribe((broadcast) => this.receive(broadcast));
  }

  /** Joins (first update) or updates a tab's state on a map. */
  update(stream: string, member: PresenceMember, patch: PresenceStatePatch): void {
    const room = this.room(stream);
    const peer = room.peers.get(member.key);
    if (!peer) {
      const joined: Peer = {
        member,
        state: { ...EMPTY_STATE, ...patch, selection: null },
        color: presenceColor(member.identity.accountId),
        since: this.now(),
        changed: new Set(),
        whole: true,
        remoteSeenAt: null,
      };
      room.peers.set(member.key, joined);
      room.left.delete(member.key);
      room.dirty.add(member.key);
      if (this.relay) room.relayDirty.add(member.key);
      room.summaryChanged = true;
      this.sendFull(stream, room, joined);
    } else if (!this.patch(room, peer, patch)) return;
    this.schedule();
  }

  leave(stream: string, key: string): void {
    const room = this.rooms.get(stream);
    const peer = room?.peers.get(key);
    if (!room || !peer) return;
    room.peers.delete(key);
    room.dirty.delete(key);
    room.relayDirty.delete(key);
    room.left.add(key);
    if (this.relay && peer.remoteSeenAt === null) room.leftLocal.add(key);
    room.summaryChanged = true;
    this.schedule();
  }

  /** Leaves every map (the socket closed). */
  leaveAll(key: string): void {
    for (const stream of this.rooms.keys()) this.leave(stream, key);
  }

  /** An account changed its choices: others see (or stop seeing) its cursor, it sees theirs. */
  applySettings(accountId: string, settings: PresenceSettingsDto): void {
    for (const [stream, room] of this.rooms) {
      for (const peer of room.peers.values()) {
        if (peer.remoteSeenAt !== null || peer.member.identity.accountId !== accountId) continue;
        peer.member = { ...peer.member, settings };
        peer.whole = true;
        room.dirty.add(peer.member.key);
        if (this.relay) room.relayDirty.add(peer.member.key);
        this.sendFull(stream, room, peer);
      }
    }
    this.schedule();
  }

  /** Everyone on a map (one entry per tab), with their full state. */
  peers(stream: string): PresencePeerDto[] {
    const room = this.rooms.get(stream);
    return room ? [...room.peers.values()].map((p) => dto(p, true)) : [];
  }

  /** Who is on a map, without cursors: one entry per tab. */
  here(stream: string): PresenceSummary[] {
    const room = this.rooms.get(stream);
    return room ? [...room.peers.values()].map(summary) : [];
  }

  /** Called (at most `hz` times a second per map) when people arrive, leave or change what they edit. */
  onChange(listener: (stream: string, here: PresenceSummary[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.unsubscribeRelay?.();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.rooms.clear();
    this.listeners.clear();
  }

  /**
   * How long a map waits between two flushes: 1/hz, or longer when that would send a viewer
   * more than `peerBudget` peer updates a second (150 people moving: 4 flushes a second).
   */
  roomIntervalMs(peers: number): number {
    const budgeted = ((peers - 1) * 1000) / this.peerBudget;
    return Math.min(MAX_INTERVAL_MS, Math.max(this.intervalMs, Math.round(budgeted)));
  }

  /**
   * Sends what changed since the last flush; runs on the timer, exposed for tests. With `force`
   * false, crowded maps whose interval has not passed yet wait for a later tick.
   */
  flush(force = true): void {
    const now = this.now();
    this.refreshRelay(now);
    for (const [stream, room] of this.rooms) {
      // Other replicas hear of changes at the full rate, whatever this map's own pace: their
      // viewers then see a cursor as fresh as this replica's do.
      this.relayChanges(stream, room);
      const due = force || now - room.lastFlushAt >= this.roomIntervalMs(room.peers.size) - 2;
      if (due && (room.dirty.size > 0 || room.left.size > 0 || room.leftLocal.size > 0)) {
        room.lastFlushAt = now;
        this.sendChanges(stream, room);
      }
      if (room.summaryChanged) {
        room.summaryChanged = false;
        const here = [...room.peers.values()].map(summary);
        for (const listener of this.listeners) {
          try {
            listener(stream, here);
          } catch {
            // A listener (plugin) must not break presence for everyone.
          }
        }
      }
      if (room.peers.size === 0 && room.left.size === 0 && room.leftLocal.size === 0)
        this.rooms.delete(stream);
    }
    if (this.rooms.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private room(stream: string): Room {
    let room = this.rooms.get(stream);
    if (!room)
      this.rooms.set(
        stream,
        (room = {
          peers: new Map(),
          dirty: new Set(),
          left: new Set(),
          relayDirty: new Set(),
          leftLocal: new Set(),
          summaryChanged: false,
          lastFlushAt: 0,
        }),
      );
    return room;
  }

  /**
   * Applies a state patch to a peer; false when nothing anyone hears of changed. Motion (cursor,
   * drag) of an idle peer is kept but never sent: when it starts changing something the others
   * get where it is, when it stops they get its cursor cleared.
   */
  private patch(room: Room, peer: Peer, patch: PresenceStatePatch): boolean {
    let changed = false;
    const wasActive = active(peer.state);
    for (const field of FIELDS) {
      if (!(field in patch)) continue;
      const value = patch[field] ?? null;
      if (sameValue(value, peer.state[field])) continue;
      (peer.state as Record<Field, unknown>)[field] = value;
      // FIELDS starts with `activity`, so this sees the activity of this very patch.
      if (MOTION.has(field) && !active(peer.state)) continue;
      peer.changed.add(field);
      if (field === 'editing') room.summaryChanged = true;
      changed = true;
    }
    if (wasActive !== active(peer.state)) {
      for (const field of MOTION) peer.changed.add(field);
      changed = true;
    }
    if (changed) {
      room.dirty.add(peer.member.key);
      if (this.relay && peer.remoteSeenAt === null) room.relayDirty.add(peer.member.key);
    }
    return changed;
  }

  /** Another replica's peers on a map: they join, change and leave like this process's own. */
  private receive(broadcast: PresenceBroadcast): void {
    if (broadcast.from === this.processId) return;
    const room = this.room(broadcast.stream);
    const now = this.now();
    for (const relayed of broadcast.peers) {
      const settings = { shareCursor: relayed.shareCursor, showOthers: true };
      const known = room.peers.get(relayed.key);
      if (!known) {
        room.peers.set(relayed.key, {
          member: { key: relayed.key, identity: relayed.identity, settings, send: () => {} },
          state: { ...EMPTY_STATE, ...relayed.state, selection: null },
          color: presenceColor(relayed.identity.accountId),
          since: relayed.since,
          changed: new Set(),
          whole: true,
          remoteSeenAt: now,
        });
        room.left.delete(relayed.key);
        room.dirty.add(relayed.key);
        room.summaryChanged = true;
        continue;
      }
      // A key belongs to one socket on one process; never let a broadcast overwrite our own.
      if (known.remoteSeenAt === null) continue;
      known.remoteSeenAt = now;
      if (known.member.settings.shareCursor !== settings.shareCursor) {
        known.member = { ...known.member, settings };
        known.whole = true;
        room.dirty.add(relayed.key);
      }
      this.patch(room, known, relayed.state);
    }
    for (const key of broadcast.left) {
      if (room.peers.get(key)?.remoteSeenAt != null) this.leave(broadcast.stream, key);
    }
    this.schedule();
  }

  /** Broadcasts this process's peers that changed since the last broadcast. */
  private relayChanges(stream: string, room: Room): void {
    if (!this.relay || (room.relayDirty.size === 0 && room.leftLocal.size === 0)) return;
    const changed = [...room.relayDirty].map((key) => room.peers.get(key)).filter((p): p is Peer => !!p);
    room.relayDirty.clear();
    this.broadcast(stream, room, changed);
  }

  /** Tells the other replicas what changed about this process's peers on a map. */
  private broadcast(stream: string, room: Room, peers: Iterable<Peer>): void {
    if (!this.relay) return;
    const local = [...peers].filter((p) => p.remoteSeenAt === null);
    const left = [...room.leftLocal];
    room.leftLocal.clear();
    if (local.length === 0 && left.length === 0) return;
    this.relay.publish({
      from: this.processId,
      stream,
      left,
      peers: local.map((p) => ({
        key: p.member.key,
        identity: p.member.identity,
        shareCursor: p.member.settings.shareCursor,
        since: p.since,
        state: sharedState(p.state),
      })),
    });
  }

  /**
   * Every RELAY_REFRESH_MS: repeats this process's peers to the others (a replica that just
   * started learns them) and forgets remote peers nobody repeated (their replica went away).
   */
  private refreshRelay(now: number): void {
    if (!this.relay || now - this.lastRefreshAt < RELAY_REFRESH_MS) return;
    this.lastRefreshAt = now;
    for (const [stream, room] of this.rooms) {
      for (const peer of [...room.peers.values()]) {
        if (peer.remoteSeenAt !== null && now - peer.remoteSeenAt > 3 * RELAY_REFRESH_MS)
          this.leave(stream, peer.member.key);
      }
      room.relayDirty.clear();
      this.broadcast(stream, room, room.peers.values());
    }
  }

  private sendChanges(stream: string, room: Room): void {
    const changed = [...room.dirty].map((key) => room.peers.get(key)).filter((p): p is Peer => !!p);
    const left = [...room.left];
    room.dirty.clear();
    room.left.clear();
    // Two renderings per changed peer, built and serialized once: for viewers who see motion
    // (cursors, drags) and for those who do not. Null: nothing to tell that kind of viewer.
    const parts = changed.map((peer) => {
      const withMotion = patchOf(peer, true);
      const withoutMotion = patchOf(peer, false);
      peer.changed.clear();
      peer.whole = false;
      return {
        peer,
        motion: withMotion && { value: withMotion, text: JSON.stringify(withMotion) },
        still: withoutMotion && { value: withoutMotion, text: JSON.stringify(withoutMotion) },
      };
    });
    const leftText = JSON.stringify(left);
    const prefix = `{"op":"presence","stream":${JSON.stringify(stream)},"full":false,"peers":[`;
    for (const viewer of room.peers.values()) {
      if (viewer.remoteSeenAt !== null) continue; // its own process tells it
      const seesMotion = viewer.member.settings.showOthers;
      const values: PresencePeerPatch[] = [];
      const texts: string[] = [];
      for (const part of parts) {
        if (part.peer === viewer) continue;
        const rendering = seesMotion ? part.motion : part.still;
        if (!rendering) continue;
        values.push(rendering.value);
        texts.push(rendering.text);
      }
      if (values.length === 0 && left.length === 0) continue;
      safeSend(
        viewer.member,
        { op: 'presence', stream, full: false, peers: values, left },
        `${prefix}${texts.join(',')}],"left":${leftText}}`,
      );
    }
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(false), this.intervalMs);
    this.timer.unref();
  }

  private sendFull(stream: string, room: Room, to: Peer): void {
    const seesMotion = to.member.settings.showOthers;
    const peers = [...room.peers.values()].filter((p) => p !== to).map((p) => dto(p, seesMotion));
    const message: PresenceMessage = { op: 'presence', stream, full: true, peers, left: [] };
    safeSend(to.member, message, JSON.stringify(message));
  }
}

/**
 * A peer in full, as a viewer sees it: no cursor or drag when either side said so, nor while the
 * peer is not changing anything.
 */
function dto(peer: Peer, viewerSeesMotion: boolean): PresencePeerDto {
  const motion = peer.member.settings.shareCursor && viewerSeesMotion;
  const shared = sharedState(peer.state);
  return {
    key: peer.member.key,
    ...peer.member.identity,
    color: peer.color,
    since: peer.since,
    ...shared,
    cursor: motion ? shared.cursor : null,
    drag: motion ? shared.drag : null,
  };
}

/**
 * What changed about a peer since the last flush, for one kind of viewer: the whole peer after a
 * join or a settings change, else its key and the changed fields (motion only when visible, and
 * null once the peer stopped changing things, so older clients drop the cursor too).
 */
function patchOf(peer: Peer, viewerSeesMotion: boolean): PresencePeerPatch | null {
  if (peer.whole) return dto(peer, viewerSeesMotion);
  const motion = peer.member.settings.shareCursor && viewerSeesMotion;
  const shared = sharedState(peer.state);
  const patch: PresencePeerPatch = { key: peer.member.key };
  let any = false;
  for (const field of peer.changed) {
    if (MOTION.has(field) && !motion) continue;
    (patch as Record<string, unknown>)[field] = shared[field];
    any = true;
  }
  return any ? patch : null;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function summary(peer: Peer): PresenceSummary {
  return { ...peer.member.identity, editing: peer.state.editing, since: peer.since };
}

function safeSend(member: PresenceMember, message: PresenceMessage, text: string): void {
  try {
    member.send(message, text);
  } catch {
    // The socket is closing; the hub removes it.
  }
}
