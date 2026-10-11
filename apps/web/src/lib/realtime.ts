import { ServerMessage } from '@wormwright/shared';

export type StreamMessage = Extract<ServerMessage, { op: 'snapshot' | 'event' | 'subscribed' | 'error' }>;
export type StreamListener = (message: StreamMessage) => void;
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
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();
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

  /** Listens to a stream; the first listener subscribes, the last one to leave unsubscribes. */
  subscribe(stream: string, listener: StreamListener): () => void {
    let state = this.streams.get(stream);
    if (!state) {
      state = { lastSeq: undefined, listeners: new Set() };
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
        this.send({ op: 'unsubscribe', stream });
      }
    };
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
    };
    socket.onmessage = (event) => this.receive(String(event.data));
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
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
    if (parsed.op === 'pong' || parsed.op === 'unsubscribed') return;
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

export function defaultRealtimeUrl(location: Location): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}
