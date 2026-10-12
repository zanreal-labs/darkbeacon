import {
  PRESENCE_COLORS,
  PRESENCE_HZ,
  type PresenceEditing,
  type PresencePeerDto,
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
  send(message: PresenceMessage): void;
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

const EMPTY_STATE: PresenceState = { cursor: null, drag: null, editing: null, selection: null };

interface Peer {
  member: PresenceMember;
  state: PresenceState;
  color: number;
  since: number;
}

interface Room {
  peers: Map<string, Peer>;
  /** Peers whose state changed since the last flush. */
  dirty: Set<string>;
  left: Set<string>;
  /** Membership or editing markers changed: plugins hear about it. */
  summaryChanged: boolean;
}

/** A colour index per account (same colour on every tab and map). */
export function presenceColor(accountId: string): number {
  let hash = 0;
  for (let i = 0; i < accountId.length; i++) hash = (Math.imul(hash, 31) + accountId.charCodeAt(i)) >>> 0;
  return hash % PRESENCE_COLORS;
}

export interface PresenceRoomsOptions {
  /** Flushes per second (default PRESENCE_HZ). */
  hz?: number;
  now?: () => number;
}

/**
 * Who is on which map and what they are doing there. In memory only, never stored and never on
 * the event log. Updates are merged per peer and sent at most `hz` times a second per map, so a
 * busy map costs the same however fast clients send.
 */
export class PresenceRooms {
  private readonly rooms = new Map<string, Room>();
  private readonly listeners = new Set<(stream: string, here: PresenceSummary[]) => void>();
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private readonly now: () => number;

  constructor(options: PresenceRoomsOptions = {}) {
    this.intervalMs = Math.round(1000 / (options.hz ?? PRESENCE_HZ));
    this.now = options.now ?? Date.now;
  }

  /** Joins (first update) or updates a tab's state on a map. */
  update(stream: string, member: PresenceMember, patch: PresenceStatePatch): void {
    let room = this.rooms.get(stream);
    if (!room)
      this.rooms.set(
        stream,
        (room = { peers: new Map(), dirty: new Set(), left: new Set(), summaryChanged: false }),
      );
    const peer = room.peers.get(member.key);
    if (!peer) {
      const joined: Peer = {
        member,
        state: { ...EMPTY_STATE, ...patch },
        color: presenceColor(member.identity.accountId),
        since: this.now(),
      };
      room.peers.set(member.key, joined);
      room.left.delete(member.key);
      room.dirty.add(member.key);
      room.summaryChanged = true;
      this.sendFull(stream, room, joined);
    } else {
      const next = { ...peer.state, ...patch };
      if (JSON.stringify(next) === JSON.stringify(peer.state)) return;
      if (JSON.stringify(next.editing) !== JSON.stringify(peer.state.editing)) room.summaryChanged = true;
      peer.state = next;
      room.dirty.add(member.key);
    }
    this.schedule();
  }

  leave(stream: string, key: string): void {
    const room = this.rooms.get(stream);
    if (!room?.peers.delete(key)) return;
    room.dirty.delete(key);
    room.left.add(key);
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
        if (peer.member.identity.accountId !== accountId) continue;
        peer.member = { ...peer.member, settings };
        room.dirty.add(peer.member.key);
        this.sendFull(stream, room, peer);
      }
    }
    this.schedule();
  }

  /** Everyone on a map (one entry per tab), with their full state. */
  peers(stream: string): PresencePeerDto[] {
    const room = this.rooms.get(stream);
    return room ? [...room.peers.values()].map((p) => this.dto(p, null)) : [];
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
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.rooms.clear();
    this.listeners.clear();
  }

  /** Sends what changed since the last flush; runs on the timer, exposed for tests. */
  flush(): void {
    for (const [stream, room] of this.rooms) {
      if (room.dirty.size > 0 || room.left.size > 0) {
        const changed = [...room.dirty].map((key) => room.peers.get(key)).filter((p): p is Peer => !!p);
        const left = [...room.left];
        for (const viewer of room.peers.values()) {
          const peers = changed
            .filter((p) => p.member.key !== viewer.member.key)
            .map((p) => this.dto(p, viewer));
          if (peers.length === 0 && left.length === 0) continue;
          safeSend(viewer.member, { op: 'presence', stream, full: false, peers, left });
        }
        room.dirty.clear();
        room.left.clear();
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
      if (room.peers.size === 0) this.rooms.delete(stream);
    }
    if (this.rooms.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), this.intervalMs);
    this.timer.unref();
  }

  private sendFull(stream: string, room: Room, to: Peer): void {
    const peers = [...room.peers.values()].filter((p) => p !== to).map((p) => this.dto(p, to));
    safeSend(to.member, { op: 'presence', stream, full: true, peers, left: [] });
  }

  /** A peer as `viewer` sees it: no cursor or drag when either side said so. */
  private dto(peer: Peer, viewer: Peer | null): PresencePeerDto {
    const motion = peer.member.settings.shareCursor && (viewer?.member.settings.showOthers ?? true);
    return {
      key: peer.member.key,
      ...peer.member.identity,
      color: peer.color,
      since: peer.since,
      cursor: motion ? peer.state.cursor : null,
      drag: motion ? peer.state.drag : null,
      editing: peer.state.editing,
      selection: peer.state.selection,
    };
  }
}

function summary(peer: Peer): PresenceSummary {
  return { ...peer.member.identity, editing: peer.state.editing, since: peer.since };
}

function safeSend(member: PresenceMember, message: PresenceMessage): void {
  try {
    member.send(message);
  } catch {
    // The socket is closing; the hub removes it.
  }
}
