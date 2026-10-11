import {
  INSTANCE_STREAM,
  parseStream,
  type Actor,
  type DomainEvent,
  type EventBus,
  type EventLog,
} from '@wormwright/core';
import type { Database } from '@wormwright/db';
import { ClientMessage, type ServerMessage, type WsErrorCode } from '@wormwright/shared';
import type { RealtimeRegistry } from './realtime.registry.js';

export interface HubOptions {
  log: EventLog;
  bus: EventBus;
  registry: RealtimeRegistry;
  database: Database;
  /** Larger gaps are answered with a snapshot instead of a replay. */
  maxReplay?: number;
  onError?: (error: unknown) => void;
}

const REPLAY_PAGE = 500;

/** One client stream subscription. Work for it runs strictly in order. */
class Subscription {
  active = true;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly stream: string,
    readonly connection: Connection,
    public lastSeq: number,
  ) {}

  enqueue(task: () => Promise<void>, onError: (error: unknown) => void): void {
    this.queue = this.queue.then(() => (this.active ? task() : undefined)).catch(onError);
  }
}

class Connection {
  actor: Actor | null = null;
  readonly subscriptions = new Map<string, Subscription>();
  /** Serializes message handling and re-authorization. */
  queue: Promise<void>;

  constructor(
    readonly resolveActor: () => Promise<Actor | null>,
    readonly send: (message: ServerMessage) => void,
  ) {
    this.queue = resolveActor().then((actor) => {
      this.actor = actor;
    });
  }
}

/** What the transport (ws gateway) holds per socket. */
export interface HubConnection {
  /** Feeds one raw text frame from the client. */
  receive(raw: string): void;
  close(): void;
}

/**
 * The realtime protocol, independent of the transport: subscribe with `sinceSeq`, replay from
 * the event log or send a snapshot, then forward live events from the bus without gaps or
 * duplicates. See `@wormwright/shared` protocol.ts.
 */
export class RealtimeHub {
  private readonly connections = new Set<Connection>();
  private readonly byStream = new Map<string, Set<Subscription>>();
  private readonly unsubscribeBus: () => void;
  private readonly maxReplay: number;
  private readonly onError: (error: unknown) => void;

  constructor(private readonly options: HubOptions) {
    this.maxReplay = options.maxReplay ?? 1000;
    this.onError = options.onError ?? ((error) => console.error('realtime error', error));
    this.unsubscribeBus = options.bus.subscribe((event) => this.dispatch(event));
  }

  /** `resolveActor` is called on connect and again when access may have changed. */
  connect(resolveActor: () => Promise<Actor | null>, send: (message: ServerMessage) => void): HubConnection {
    const connection = new Connection(resolveActor, send);
    this.connections.add(connection);
    return {
      receive: (raw) => this.serialize(connection, () => this.receive(connection, raw)),
      close: () => this.disconnect(connection),
    };
  }

  close(): void {
    this.unsubscribeBus();
    for (const connection of this.connections) this.disconnect(connection);
  }

  private serialize(connection: Connection, task: () => Promise<void>): void {
    connection.queue = connection.queue.then(task).catch((error: unknown) => {
      this.onError(error);
      connection.send({ op: 'error', code: 'internal', message: 'Internal error' });
    });
  }

  private async receive(connection: Connection, raw: string): Promise<void> {
    let message: ClientMessage;
    try {
      message = ClientMessage.parse(JSON.parse(raw));
    } catch {
      connection.send({ op: 'error', code: 'bad_request', message: 'Malformed message' });
      return;
    }
    if (message.op === 'ping') connection.send({ op: 'pong' });
    else if (message.op === 'unsubscribe') {
      this.drop(connection, message.stream);
      connection.send({ op: 'unsubscribed', stream: message.stream });
    } else await this.subscribe(connection, message.stream, message.sinceSeq);
  }

  private async subscribe(
    connection: Connection,
    stream: string,
    sinceSeq: number | undefined,
  ): Promise<void> {
    const denied = await this.denial(connection, stream);
    if (denied) {
      connection.send({ op: 'error', stream, ...denied });
      return;
    }
    this.drop(connection, stream);
    const sub = new Subscription(stream, connection, sinceSeq ?? 0);
    connection.subscriptions.set(stream, sub);
    let set = this.byStream.get(stream);
    if (!set) this.byStream.set(stream, (set = new Set()));
    set.add(sub);
    // Registered before catching up, so live events queue behind the catch-up and are de-duplicated by seq.
    sub.enqueue(
      () => this.catchUp(sub, sinceSeq),
      (error) => this.fail(sub, error),
    );
  }

  private async denial(
    connection: Connection,
    stream: string,
  ): Promise<{ code: WsErrorCode; message: string } | null> {
    const parsed = parseStream(stream);
    const kind = parsed && this.options.registry.stream(parsed.kind);
    if (!parsed || !kind) return { code: 'unknown_stream', message: `Unknown stream ${stream}` };
    if (await kind.authorize(connection.actor, parsed.id)) return null;
    return connection.actor
      ? { code: 'forbidden', message: 'You cannot follow this stream' }
      : { code: 'unauthenticated', message: 'Sign in first' };
  }

  private async catchUp(sub: Subscription, sinceSeq: number | undefined): Promise<void> {
    const { log } = this.options;
    const head = await log.headSeq(sub.stream);
    let replayable = sinceSeq !== undefined && sinceSeq <= head && head - sinceSeq <= this.maxReplay;
    if (replayable && sinceSeq! < head) {
      const oldest = await log.oldestSeq(sub.stream);
      replayable = oldest !== null && oldest <= sinceSeq! + 1;
    }
    if (replayable) await this.replay(sub);
    else await this.snapshot(sub);
    if (sub.active) {
      sub.connection.send({
        op: 'subscribed',
        stream: sub.stream,
        seq: sub.lastSeq,
        mode: replayable ? 'replay' : 'snapshot',
      });
    }
  }

  private async replay(sub: Subscription): Promise<void> {
    for (;;) {
      const events = await this.options.log.readSince(sub.stream, sub.lastSeq, REPLAY_PAGE);
      for (const event of events) this.deliver(sub, event);
      if (events.length < REPLAY_PAGE || !sub.active) return;
    }
  }

  private async snapshot(sub: Subscription): Promise<void> {
    const { kind, id } = parseStream(sub.stream)!;
    const { database, log, registry } = this.options;
    const actor = sub.connection.actor;
    const { seq, data } = await database.transaction(
      async () => {
        const seq = await log.headSeq(sub.stream);
        const data: Record<string, unknown> = {};
        for (const provider of registry.snapshotProviders(kind))
          Object.assign(data, await provider(id, actor));
        return { seq, data };
      },
      { isolation: 'repeatable read' },
    );
    sub.lastSeq = seq;
    if (sub.active) sub.connection.send({ op: 'snapshot', stream: sub.stream, seq, data });
  }

  private deliver(sub: Subscription, event: DomainEvent): void {
    if (!sub.active || event.seq <= sub.lastSeq) return;
    sub.lastSeq = event.seq;
    sub.connection.send({ op: 'event', event });
  }

  private dispatch(event: DomainEvent): void {
    for (const sub of this.byStream.get(event.stream) ?? []) {
      sub.enqueue(
        async () => {
          if (event.seq === sub.lastSeq + 1) this.deliver(sub, event);
          else if (event.seq > sub.lastSeq) await this.replay(sub); // fill the gap from the log
        },
        (error) => this.fail(sub, error),
      );
    }
    if (event.type.startsWith('access.')) this.reauthorize(event.stream);
  }

  /** Access changed: re-resolve actors and drop subscriptions that are no longer allowed. */
  private reauthorize(stream: string): void {
    for (const connection of this.connections) {
      const affected = [...connection.subscriptions.values()].filter(
        (s) => stream === INSTANCE_STREAM || s.stream === stream,
      );
      if (affected.length === 0) continue;
      this.serialize(connection, async () => {
        connection.actor = await connection.resolveActor();
        for (const sub of affected) {
          if (!sub.active) continue;
          const denied = await this.denial(connection, sub.stream);
          if (denied) {
            this.drop(connection, sub.stream);
            connection.send({ op: 'error', stream: sub.stream, ...denied });
          }
        }
      });
    }
  }

  private fail(sub: Subscription, error: unknown): void {
    this.onError(error);
    this.drop(sub.connection, sub.stream);
    sub.connection.send({
      op: 'error',
      stream: sub.stream,
      code: 'internal',
      message: 'Subscription failed',
    });
  }

  private drop(connection: Connection, stream: string): void {
    const sub = connection.subscriptions.get(stream);
    if (!sub) return;
    sub.active = false;
    connection.subscriptions.delete(stream);
    const set = this.byStream.get(stream);
    set?.delete(sub);
    if (set?.size === 0) this.byStream.delete(stream);
  }

  private disconnect(connection: Connection): void {
    for (const stream of [...connection.subscriptions.keys()]) this.drop(connection, stream);
    this.connections.delete(connection);
  }
}
