import {
  INSTANCE_STREAM,
  grantOf,
  newId,
  parseStream,
  type Actor,
  type DomainEvent,
  type EventBus,
  type EventLog,
} from '@darkbeacon/core';
import type { Database } from '@darkbeacon/db';
import {
  ClientMessage,
  isEventOfType,
  scopesAllow,
  type PresenceSettingsDto,
  type PresenceStatePatch,
  type ServerMessage,
  type WsErrorCode,
} from '@darkbeacon/shared';
import type { PresenceIdentity, PresenceRooms } from './presence.js';
import type { RealtimeRegistry } from './realtime.registry.js';

/** Presence over the socket: the rooms, and how a signed-in account is shown and what it chose. */
export interface HubPresence {
  rooms: PresenceRooms;
  identify(accountId: string): Promise<PresenceIdentity>;
  settings(accountId: string): Promise<PresenceSettingsDto>;
}

export interface HubOptions {
  log: EventLog;
  bus: EventBus;
  registry: RealtimeRegistry;
  database: Database;
  /** Presence on map streams; without it presence messages are ignored. */
  presence?: HubPresence;
  /** Larger gaps are answered with a snapshot instead of a replay. */
  maxReplay?: number;
  /** Streams one connection may follow at once. */
  maxSubscriptions?: number;
  /**
   * How often every connection's actor and subscriptions are checked again, besides the
   * `access.*` events (catches expired sessions and anything that changed without an event).
   */
  recheckMs?: number;
  onError?: (error: unknown) => void;
  /** Runs work in a trace span (telemetry); subscriptions and catch-ups are traced with it. */
  trace?: <T>(name: string, attributes: Record<string, string>, work: () => Promise<T>) => Promise<T>;
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
    /** Where events come from: the stream itself, or the source of a view stream. */
    readonly source: string = stream,
    /** Filters events of a view stream. */
    readonly project: ((event: DomainEvent) => Promise<DomainEvent | null>) | null = null,
  ) {}

  enqueue(task: () => Promise<void>, onError: (error: unknown) => void): void {
    this.queue = this.queue.then(() => (this.active ? task() : undefined)).catch(onError);
  }
}

class Connection {
  actor: Actor | null = null;
  readonly subscriptions = new Map<string, Subscription>();
  /** This socket's key in presence rooms. */
  readonly presenceKey = newId();
  /** Maps this socket is present on. */
  readonly present = new Set<string>();
  /** Looked up on the first presence message (per account; reset when the account changes). */
  presenceProfile: { accountId: string; identity: PresenceIdentity; settings: PresenceSettingsDto } | null =
    null;
  /** Serializes message handling and re-authorization. */
  queue: Promise<void>;

  constructor(
    readonly resolveActor: () => Promise<Actor | null>,
    readonly send: (message: ServerMessage) => void,
    /** Closes the transport: the session behind the connection ended. */
    readonly end: () => void,
    readonly client: { ip: string | null } = { ip: null },
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
 * duplicates. See `@darkbeacon/shared` protocol.ts.
 */
export class RealtimeHub {
  private readonly connections = new Set<Connection>();
  private readonly byStream = new Map<string, Set<Subscription>>();
  private readonly unsubscribeBus: () => void;
  private readonly recheckTimer: NodeJS.Timeout;
  private readonly maxReplay: number;
  private readonly maxSubscriptions: number;
  private readonly onError: (error: unknown) => void;

  constructor(private readonly options: HubOptions) {
    this.maxReplay = options.maxReplay ?? 1000;
    this.maxSubscriptions = options.maxSubscriptions ?? 50;
    this.onError = options.onError ?? ((error) => console.error('realtime error', error));
    this.unsubscribeBus = options.bus.subscribe((event) => this.dispatch(event));
    this.recheckTimer = setInterval(() => this.recheckAll(), options.recheckMs ?? 60_000).unref();
  }

  /**
   * `resolveActor` is called on connect and again when access may have changed; `end` closes
   * the transport once a signed-in connection's session no longer resolves.
   */
  connect(
    resolveActor: () => Promise<Actor | null>,
    send: (message: ServerMessage) => void,
    end: () => void = () => {},
    client: { ip: string | null } = { ip: null },
  ): HubConnection {
    const connection = new Connection(resolveActor, send, end, client);
    this.connections.add(connection);
    return {
      receive: (raw) => this.serialize(connection, () => this.receive(connection, raw)),
      close: () => this.disconnect(connection),
    };
  }

  /** Open connections (sockets). */
  get connectionCount(): number {
    return this.connections.size;
  }

  close(): void {
    clearInterval(this.recheckTimer);
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
    } else if (message.op === 'presence') await this.presence(connection, message.stream, message.state);
    else if (message.op === 'presence.leave') this.leavePresence(connection, message.stream);
    else {
      const { stream, sinceSeq } = message;
      await this.traced('ws subscribe', stream, () => this.subscribe(connection, stream, sinceSeq));
    }
  }

  private traced<T>(name: string, stream: string, work: () => Promise<T>): Promise<T> {
    const trace = this.options.trace;
    return trace
      ? trace(name, { 'darkbeacon.stream.kind': parseStream(stream)?.kind ?? 'unknown' }, work)
      : work();
  }

  /**
   * Presence on a map: only signed-in accounts, only on a map stream this socket follows (so the
   * same authorization as the map itself, re-checked with it). Anything else is ignored.
   */
  private async presence(connection: Connection, stream: string, state: PresenceStatePatch): Promise<void> {
    const presence = this.options.presence;
    const actor = connection.actor;
    if (!presence || actor?.kind !== 'account') return;
    if (parseStream(stream)?.kind !== 'map' || !connection.subscriptions.get(stream)?.active) return;
    if (connection.presenceProfile?.accountId !== actor.id) {
      const [identity, settings] = await Promise.all([
        presence.identify(actor.id),
        presence.settings(actor.id),
      ]);
      connection.presenceProfile = { accountId: actor.id, identity, settings };
    }
    // The subscription may have been dropped while the account was looked up.
    if (!connection.subscriptions.get(stream)?.active || !this.connections.has(connection)) return;
    const { identity, settings } = connection.presenceProfile;
    connection.present.add(stream);
    presence.rooms.update(
      stream,
      { key: connection.presenceKey, identity, settings, send: (message) => connection.send(message) },
      state,
    );
  }

  /** An account changed its presence choices: its sockets and the rooms follow at once. */
  presenceSettingsChanged(accountId: string, settings: PresenceSettingsDto): void {
    for (const connection of this.connections) {
      if (connection.presenceProfile?.accountId === accountId)
        connection.presenceProfile = { ...connection.presenceProfile, settings };
    }
    this.options.presence?.rooms.applySettings(accountId, settings);
  }

  private leavePresence(connection: Connection, stream: string): void {
    if (!connection.present.delete(stream)) return;
    this.options.presence?.rooms.leave(stream, connection.presenceKey);
  }

  private async subscribe(
    connection: Connection,
    stream: string,
    sinceSeq: number | undefined,
  ): Promise<void> {
    if (!connection.subscriptions.has(stream) && connection.subscriptions.size >= this.maxSubscriptions) {
      connection.send({ op: 'error', stream, code: 'bad_request', message: 'Too many subscriptions' });
      return;
    }
    const parsed = parseStream(stream);
    const kind = parsed ? this.options.registry.stream(parsed.kind) : undefined;
    if (parsed && kind?.admit && !kind.admit(parsed.id, connection.client)) {
      connection.send({
        op: 'error',
        stream,
        code: 'bad_request',
        message: 'Too many subscriptions; slow down',
      });
      return;
    }
    const denied = await this.denial(connection, stream);
    if (denied) {
      connection.send({ op: 'error', stream, ...denied });
      return;
    }
    let source = stream;
    let project: Subscription['project'] = null;
    if (parsed && kind?.view) {
      const view = kind.view;
      const resolved = await view.source(parsed.id);
      if (!resolved) {
        connection.send({ op: 'error', stream, code: 'forbidden', message: 'You cannot follow this stream' });
        return;
      }
      source = resolved;
      project = (event) => view.project(parsed.id, event, stream);
    }
    this.drop(connection, stream);
    const sub = new Subscription(stream, connection, sinceSeq ?? 0, source, project);
    connection.subscriptions.set(stream, sub);
    let set = this.byStream.get(source);
    if (!set) this.byStream.set(source, (set = new Set()));
    set.add(sub);
    // Registered before catching up, so live events queue behind the catch-up and are de-duplicated by seq.
    sub.enqueue(
      () => this.traced('ws catch-up', stream, () => this.catchUp(sub, sinceSeq)),
      (error) => this.fail(sub, error),
    );
  }

  private denial(
    connection: Connection,
    stream: string,
  ): Promise<{ code: WsErrorCode; message: string } | null> {
    return this.check(connection.actor, stream);
  }

  private async catchUp(sub: Subscription, sinceSeq: number | undefined): Promise<void> {
    const { log } = this.options;
    const head = await log.headSeq(sub.source);
    let replayable = sinceSeq !== undefined && sinceSeq <= head && head - sinceSeq <= this.maxReplay;
    if (replayable && sinceSeq! < head) {
      const oldest = await log.oldestSeq(sub.source);
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
      const events = await this.options.log.readSince(sub.source, sub.lastSeq, REPLAY_PAGE);
      for (const event of events) await this.deliver(sub, event);
      if (events.length < REPLAY_PAGE || !sub.active) return;
    }
  }

  private async snapshot(sub: Subscription): Promise<void> {
    const { seq, data } = await this.readSnapshot(sub.stream, sub.connection.actor);
    sub.lastSeq = seq;
    if (sub.active) sub.connection.send({ op: 'snapshot', stream: sub.stream, seq, data });
  }

  /**
   * May `actor` follow `stream`? Null when allowed, else the reason (the same check a subscribe
   * runs, also used by the REST snapshot).
   */
  async check(actor: Actor | null, stream: string): Promise<{ code: WsErrorCode; message: string } | null> {
    const parsed = parseStream(stream);
    const kind = parsed && this.options.registry.stream(parsed.kind);
    if (!parsed || !kind) return { code: 'unknown_stream', message: `Unknown stream ${stream}` };
    // A credential follows a map stream only with read scopes on everything there (the stream
    // carries every kind of map event), the instance stream with `account:read`.
    const grant = grantOf(actor);
    if (grant) {
      const allowed =
        parsed.kind === 'map'
          ? scopesAllow(grant.scopes, { resource: '*', action: 'read' }, parsed.id)
          : parsed.kind === 'instance'
            ? scopesAllow(grant.scopes, { resource: 'account', action: 'read' }, null)
            : parsed.kind === 'audit'
              ? scopesAllow(grant.scopes, { resource: 'admin', action: 'read' }, null)
              : true;
      if (!allowed) return { code: 'forbidden', message: 'This API key lacks the scopes for this stream' };
    }
    if (await kind.authorize(actor, parsed.id)) return null;
    return actor
      ? { code: 'forbidden', message: 'You cannot follow this stream' }
      : { code: 'unauthenticated', message: 'Sign in first' };
  }

  /**
   * The merged snapshot of a stream and the head seq it corresponds to, read in one repeatable-read
   * transaction. Callers authorize first (see `check`).
   */
  async readSnapshot(
    stream: string,
    actor: Actor | null,
  ): Promise<{ seq: number; data: Record<string, unknown> }> {
    const { kind, id } = parseStream(stream)!;
    const { database, log, registry } = this.options;
    const source = (await registry.stream(kind)?.view?.source(id)) ?? stream;
    return database.transaction(
      async () => {
        const seq = await log.headSeq(source);
        const data: Record<string, unknown> = {};
        for (const provider of registry.snapshotProviders(kind))
          Object.assign(data, await provider(id, actor));
        return { seq, data };
      },
      { isolation: 'repeatable read' },
    );
  }

  private async deliver(sub: Subscription, event: DomainEvent): Promise<void> {
    if (!sub.active || event.seq <= sub.lastSeq) return;
    sub.lastSeq = event.seq;
    const shown = sub.project ? await sub.project(event) : event;
    if (shown && sub.active) sub.connection.send({ op: 'event', event: shown });
  }

  private dispatch(event: DomainEvent): void {
    for (const sub of this.byStream.get(event.stream) ?? []) {
      sub.enqueue(
        async () => {
          if (event.seq === sub.lastSeq + 1) await this.deliver(sub, event);
          else if (event.seq > sub.lastSeq) await this.replay(sub); // fill the gap from the log
        },
        (error) => this.fail(sub, error),
      );
    }
    if (isEventOfType(event, 'access.account_changed')) {
      // One account's subjects or sessions changed: only its connections are checked.
      const { accountId } = event.data;
      for (const connection of this.connections) {
        if (connection.actor?.kind === 'account' && connection.actor.id === accountId)
          this.reauthorize(connection);
      }
    } else if (event.type.startsWith('access.')) {
      for (const connection of this.connections) {
        if (
          [...connection.subscriptions.values()].some(
            (s) => event.stream === INSTANCE_STREAM || s.source === event.stream,
          )
        ) {
          this.reauthorize(connection);
        }
      }
    }
  }

  /** Checks every connection again (on a timer). */
  recheckAll(): void {
    for (const connection of this.connections) this.reauthorize(connection);
  }

  /**
   * Re-resolves the actor and drops subscriptions that are no longer allowed. A connection
   * that was signed in and no longer is (logout, expired session) is closed.
   */
  private reauthorize(connection: Connection): void {
    this.serialize(connection, async () => {
      if (!this.connections.has(connection)) return;
      const before = connection.actor;
      connection.actor = await connection.resolveActor();
      if (before !== null && connection.actor === null) {
        this.disconnect(connection);
        connection.end();
        return;
      }
      for (const sub of [...connection.subscriptions.values()]) {
        if (!sub.active) continue;
        const denied = await this.denial(connection, sub.stream);
        if (denied) {
          this.drop(connection, sub.stream);
          connection.send({ op: 'error', stream: sub.stream, ...denied });
        }
      }
    });
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
    this.leavePresence(connection, stream);
    const sub = connection.subscriptions.get(stream);
    if (!sub) return;
    sub.active = false;
    connection.subscriptions.delete(stream);
    const set = this.byStream.get(sub.source);
    set?.delete(sub);
    if (set?.size === 0) this.byStream.delete(sub.source);
  }

  private disconnect(connection: Connection): void {
    for (const stream of [...connection.subscriptions.keys()]) this.drop(connection, stream);
    this.connections.delete(connection);
  }
}
