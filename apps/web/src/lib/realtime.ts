import { RESTORED_CLOSE_CODE, ServerMessage, type PresenceStatePatch } from '@darkbeacon/shared';

export type StreamMessage = Extract<ServerMessage, { op: 'snapshot' | 'event' | 'subscribed' | 'error' }>;
export type StreamListener = (message: StreamMessage) => void;
export type PresenceMessage = Extract<ServerMessage, { op: 'presence' }>;
export type PresenceListener = (message: PresenceMessage) => void;
export type IntelMessage = Extract<ServerMessage, { op: 'intel' }>;
export type IntelListener = (message: IntelMessage) => void;
export type ConnectionStatus = 'connecting' | 'open' | 'closed';

interface MinimalSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export interface RealtimeClientOptions {
  url: string;
  createSocket?: (url: string) => MinimalSocket;
  /** Delay before reconnect attempt n (1-based). */
  backoff?: (attempt: number) => number;
}

interface StreamState {
  /** Last seq seen; undefined until the first snapshot or event, so the server sends a snapshot. */
  lastSeq: number | undefined;
  listeners: Set<StreamListener>;
}

const OPEN = 1;

/**
 * The single WebSocket of the app. Keeps the last seq per stream and, after a reconnect,
 * re-subscribes with `sinceSeq` so the server only replays what was missed.
 */
export class RealtimeClient {
  private socket: MinimalSocket | null = null;
  private readonly streams = new Map<string, StreamState>();
  /** What this tab shares per map, re-sent after a reconnect (presence is not stored anywhere). */
  private readonly presence = new Map<string, PresenceStatePatch>();
  private readonly presenceListeners = new Map<string, Set<PresenceListener>>();
  private readonly intelListeners = new Map<string, Set<IntelListener>>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();
  private readonly resetListeners = new Set<() => void>();
  private readonly latencyListeners = new Set<(ms: number | null) => void>();
  /** When the unanswered ping was sent (performance.now()); null with none out. */
  private pingSentAt: number | null = null;
  /** Round trip in ms (the best of the last few pings); null until one was answered on this socket. */
  latency: number | null = null;
  private latencySamples: number[] = [];
  private attempt = 0;
  private stopped = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  status: ConnectionStatus = 'closed';

  constructor(private readonly options: RealtimeClientOptions) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
    this.setStatus('closed');
  }

  /** Opens a fresh socket, e.g. after sign in, so the server sees the new session cookie. */
  reconnect(): void {
    if (this.stopped) return;
    clearTimeout(this.timer);
    const old = this.socket;
    this.socket = null;
    old?.close();
    this.attempt = 0;
    this.open();
  }

  /**
   * Listens to a stream; the first listener subscribes, the last one to leave unsubscribes.
   * `sinceSeq` is the seq of state the caller already has (a server-rendered snapshot), so the
   * server only replays what came after it instead of sending a snapshot.
   */
  subscribe(stream: string, listener: StreamListener, sinceSeq?: number): () => void {
    let state = this.streams.get(stream);
    if (!state) {
      state = { lastSeq: sinceSeq, listeners: new Set() };
      this.streams.set(stream, state);
      this.sendSubscribe(stream, state);
    }
    state.listeners.add(listener);
    return () => {
      const current = this.streams.get(stream);
      if (!current) return;
      current.listeners.delete(listener);
      if (current.listeners.size === 0) {
        this.streams.delete(stream);
        this.presence.delete(stream);
        this.send({ op: 'unsubscribe', stream });
      }
    };
  }

  /**
   * Shares (part of) this tab's presence on a map stream the client follows; the first call
   * joins. Fields left out keep their value, null clears one. Callers throttle (see PresenceStore).
   */
  sendPresence(stream: string, patch: PresenceStatePatch): void {
    this.presence.set(stream, { ...this.presence.get(stream), ...patch });
    this.send({ op: 'presence', stream, state: patch });
  }

  /** Stops sharing presence on a map (others see this tab leave). */
  leavePresence(stream: string): void {
    if (!this.presence.delete(stream)) return;
    this.send({ op: 'presence.leave', stream });
  }

  /** Others' presence on a stream: the full list on joining, then changes. */
  onPresence(stream: string, listener: PresenceListener): () => void {
    let set = this.presenceListeners.get(stream);
    if (!set) this.presenceListeners.set(stream, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.presenceListeners.delete(stream);
    };
  }

  /** Intel of a map stream the client follows (sovereignty, hourly figures, kill counts). */
  onIntel(stream: string, listener: IntelListener): () => void {
    let set = this.intelListeners.get(stream);
    if (!set) this.intelListeners.set(stream, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.intelListeners.delete(stream);
    };
  }

  /** Called after the server's database was replaced (a restore): everything held is stale. */
  onReset(listener: () => void): () => void {
    this.resetListeners.add(listener);
    return () => this.resetListeners.delete(listener);
  }

  /** Measures the round trip to the server once (an answered ping updates `latency`). */
  ping(): void {
    if (this.socket?.readyState !== OPEN) return;
    // A ping unanswered for 10 s is given up, so a lost pong does not stop measuring.
    if (this.pingSentAt !== null && performance.now() - this.pingSentAt < 10_000) return;
    this.pingSentAt = performance.now();
    this.send({ op: 'ping' });
  }

  onLatency(listener: (ms: number | null) => void): () => void {
    this.latencyListeners.add(listener);
    return () => this.latencyListeners.delete(listener);
  }

  /**
   * A busy page (just loaded, rendering a big map) answers late; the best of the last three
   * round trips is the network's, which is what the dot shows.
   */
  private setLatency(ms: number | null): void {
    this.latencySamples = ms === null ? [] : [...this.latencySamples, ms].slice(-3);
    const next = ms === null ? null : Math.min(...this.latencySamples);
    if (next === this.latency) return;
    this.latency = next;
    for (const listener of this.latencyListeners) listener(next);
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private open(): void {
    const create =
      this.options.createSocket ?? ((url: string) => new WebSocket(url) as unknown as MinimalSocket);
    const socket = create(this.options.url);
    this.socket = socket;
    this.setStatus('connecting');
    socket.onopen = () => {
      this.attempt = 0;
      this.setStatus('open');
      for (const [stream, state] of this.streams) this.sendSubscribe(stream, state);
      // After the subscribes, so the server knows the streams: join again with the last state.
      for (const [stream, state] of this.presence) this.send({ op: 'presence', stream, state });
    };
    socket.onmessage = (event) => this.receive(String(event.data));
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.pingSentAt = null;
      this.setLatency(null);
      if ((event as { code?: number } | undefined)?.code === RESTORED_CLOSE_CODE) {
        // The seqs held belong to the old database: resubscribe from snapshots.
        for (const state of this.streams.values()) state.lastSeq = undefined;
        for (const listener of this.resetListeners) listener();
      }
      this.setStatus('closed');
      if (this.stopped) return;
      const delay = (this.options.backoff ?? defaultBackoff)(++this.attempt);
      this.timer = setTimeout(() => this.open(), delay);
    };
  }

  private receive(raw: string): void {
    let parsed: ServerMessage;
    try {
      parsed = ServerMessage.parse(JSON.parse(raw));
    } catch {
      return;
    }
    if (parsed.op === 'pong') {
      if (this.pingSentAt !== null) this.setLatency(Math.round(performance.now() - this.pingSentAt));
      this.pingSentAt = null;
      return;
    }
    if (parsed.op === 'unsubscribed') return;
    if (parsed.op === 'presence') {
      for (const listener of this.presenceListeners.get(parsed.stream) ?? []) listener(parsed);
      return;
    }
    if (parsed.op === 'intel') {
      for (const listener of this.intelListeners.get(parsed.stream) ?? []) listener(parsed);
      return;
    }
    const stream = parsed.op === 'event' ? parsed.event.stream : parsed.stream;
    const state = stream === undefined ? undefined : this.streams.get(stream);
    if (!state) return;
    if (parsed.op === 'event') {
      // The server never repeats a seq; this guards against overlapping replays after a reconnect.
      if (state.lastSeq !== undefined && parsed.event.seq <= state.lastSeq) return;
      state.lastSeq = parsed.event.seq;
    } else if (parsed.op === 'snapshot' || parsed.op === 'subscribed') {
      state.lastSeq = parsed.seq;
    }
    for (const listener of state.listeners) listener(parsed);
  }

  private sendSubscribe(stream: string, state: StreamState): void {
    this.send({
      op: 'subscribe',
      stream,
      ...(state.lastSeq !== undefined ? { sinceSeq: state.lastSeq } : {}),
    });
  }

  private send(message: object): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(message));
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

function defaultBackoff(attempt: number): number {
  return Math.min(30_000, 500 * 2 ** (attempt - 1)) * (0.75 + Math.random() * 0.5);
}

export function defaultRealtimeUrl(location: Pick<Location, 'protocol' | 'host'>): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}
