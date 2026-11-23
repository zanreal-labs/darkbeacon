import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import {
  emptyDump,
  isRow,
  readConnection,
  readHubIds,
  readSignature,
  readSystem,
  SourceError,
  text,
  type MapImportSource,
  type SourceRequest,
  type WandererMapDump,
  type WandererSessionRequest,
} from '@darkbeacon/importing';
import WebSocket from 'ws';
import { isPublicAddress } from '../notifications/http-webhook-sender.js';
import { privateTarget, publicOnlyLookup } from './wanderer-http.js';

export interface WandererSessionOptions {
  /** The map page request. */
  pageTimeoutMs?: number;
  /** From joining the map's live connection until the map has arrived. */
  mapTimeoutMs?: number;
  /** One signature request. */
  replyTimeoutMs?: number;
  /** Signature requests in flight at once. */
  concurrency?: number;
  /** Largest map page read (bytes). */
  maxPageBytes?: number;
  now?: () => number;
}

/** Wanderer's session cookie. */
export const WANDERER_SESSION_COOKIE = '_wanderer_app_key';

const USER_AGENT = 'Darkbeacon-link (+https://github.com/darkbeacon; reads one map its owner may open)';
const HEARTBEAT_MS = 25_000;

/** What the map page hands its live connection. */
export interface LivePage {
  csrfToken: string;
  /** The id of the page's main live view (the topic is `lv:<id>`). */
  viewId: string;
  session: string;
  static: string;
  /** The app version the page was built with: the map sends nothing to a client on another. */
  version: string | null;
  /** The session cookie to go on with (Wanderer may renew it on the page request). */
  cookie: string;
}

/**
 * Reads a Wanderer map the way the map's own page does, signed in with somebody's session
 * cookie, for maps whose owner hands out no API key. Wanderer's HTTP API takes map API keys
 * only; a signed-in browser gets the map over a Phoenix LiveView connection instead:
 *
 * 1. `GET /:slug` with the cookie gives the page, with the CSRF token, the live view's id, its
 *    signed session and static tokens, and the app version (`data-version`);
 * 2. `/live/websocket` is joined as `lv:<id>`; the client says `ui_loaded` with the version, and
 *    the map answers with a `map_event` of type `init`: the shown systems with their names,
 *    positions, statuses, tags and labels, the connections between them, and the hubs;
 * 3. `get_signatures` is asked once per system.
 *
 * Only what the map shows comes over: hidden systems, structures, comments and access lists stay
 * where they are. Reading looks like the account sitting on the map for a few seconds.
 */
export class WandererSessionSource implements MapImportSource {
  readonly kind = 'wanderer-session' as const;

  constructor(private readonly options: WandererSessionOptions = {}) {}

  async test(
    request: SourceRequest,
  ): Promise<{ systems: number; hiddenSystems: number | null; name: string | null }> {
    const live = asSession(request);
    const init = await this.withMap(live, async (map) => map.init);
    return { systems: list(init.systems).length, hiddenSystems: null, name: live.slug };
  }

  async read(
    request: SourceRequest,
    onStep: (step: string) => void = () => undefined,
  ): Promise<WandererMapDump> {
    const live = asSession(request);
    const now = this.options.now ?? Date.now;
    const dump = emptyDump(
      { kind: 'wanderer-session', host: live.base.host, slug: live.slug, name: live.slug },
      now(),
    );
    dump.map.slug = live.slug;
    dump.warnings.push(
      'Read as a signed-in pilot: only what the map shows came over (no hidden systems, structures, comments or access lists)',
    );

    await this.withMap(live, async (map) => {
      onStep('systems');
      const names = new Map<number, string>();
      for (const info of list(map.init.system_static_infos)) {
        if (!isRow(info)) continue;
        const id = Number(info.solar_system_id);
        const name = text(info.solar_system_name);
        if (Number.isInteger(id) && name) names.set(id, name);
      }
      for (const row of list(map.init.systems)) {
        if (!isRow(row)) continue;
        const solarSystemId = Number(row.id);
        const system = readSystem({
          ...row,
          id: undefined,
          solar_system_id: row.id,
          original_name: Number.isInteger(solarSystemId) ? (names.get(solarSystemId) ?? null) : null,
        });
        if (system) dump.systems.push(system);
        else count(dump.rejected, 'systems');
      }

      onStep('connections');
      for (const row of list(map.init.connections)) {
        const connection = readConnection(row);
        if (connection) dump.connections.push(connection);
        else count(dump.rejected, 'connections');
      }
      dump.hubs = readHubIds(map.init.hubs);

      onStep('signatures');
      const failed: number[] = [];
      await eachLimited(dump.systems, this.options.concurrency ?? 4, async (system) => {
        let reply: unknown;
        try {
          reply = await map.ask('get_signatures', { system_id: String(system.solarSystemId) });
        } catch {
          failed.push(system.solarSystemId);
          return;
        }
        for (const row of isRow(reply) ? list(reply.signatures) : []) {
          if (!isRow(row) || row.deleted === true) continue;
          const linked = isRow(row.linked_system) ? row.linked_system.solar_system_id : null;
          const signature = readSignature({
            ...row,
            solar_system_id: system.solarSystemId,
            linked_system_id: linked,
            inserted_at: wandererTime(row.inserted_at),
            updated_at: wandererTime(row.updated_at),
          });
          if (signature) dump.signatures.push(signature);
          else count(dump.rejected, 'signatures');
        }
      });
      if (failed.length > 0)
        dump.warnings.push(
          `Signatures of ${failed.length} system(s) did not arrive and were left as they were`,
        );
    });
    return dump;
  }

  /**
   * Opens the map's live connection, waits for the map, runs `use`, and closes the connection
   * whatever happens.
   */
  private async withMap<T>(
    request: WandererSessionRequest,
    use: (map: {
      init: Record<string, unknown>;
      ask: (event: string, value: unknown) => Promise<unknown>;
    }) => Promise<T>,
  ): Promise<T> {
    const page = await this.page(request);
    const channel = await LiveChannel.open(request, page, this.options);
    try {
      const init = await channel.map(page.version, this.options.mapTimeoutMs ?? 45_000);
      return await use({
        init,
        ask: (event, value) => channel.ask(event, value, this.options.replyTimeoutMs ?? 20_000),
      });
    } finally {
      channel.close();
    }
  }

  /** The map page, signed in. */
  private page(request: WandererSessionRequest): Promise<LivePage> {
    guardAddress(request);
    const url = new URL(`/${encodeURIComponent(request.slug)}`, `${request.base.url}/`);
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const maxBytes = this.options.maxPageBytes ?? 5 * 1024 * 1024;
    const cookie = sessionCookie(request.cookie);
    return new Promise<LivePage>((resolve, reject) => {
      const req = send(
        url,
        {
          method: 'GET',
          headers: {
            cookie: `${WANDERER_SESSION_COOKIE}=${cookie}`,
            accept: 'text/html',
            'user-agent': USER_AGENT,
          },
          agent: false,
          signal: AbortSignal.timeout(this.options.pageTimeoutMs ?? 20_000),
          ...(request.allowPrivate ? {} : { lookup: publicOnlyLookup }),
          ...(url.protocol === 'https:' && request.insecureTls ? { rejectUnauthorized: false } : {}),
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            response.resume();
            return reject(signedOut(request));
          }
          if (status === 404) {
            response.resume();
            return reject(new SourceError('not_found', `${request.base.host} has no map ${request.slug}`));
          }
          if (status === 401 || status === 403) {
            response.resume();
            return reject(signedOut(request));
          }
          if (status >= 500 || status !== 200) {
            response.resume();
            return reject(
              new SourceError('unavailable', `${request.base.host} answered ${status} for the map page`),
            );
          }
          readBody(response, maxBytes)
            .then((html) => {
              const page = parseLivePage(html, renewedCookie(response) ?? cookie);
              if (!page) return reject(signedOut(request));
              resolve(page);
            })
            .catch((error: unknown) => reject(unavailable(request, error)));
        },
      );
      req.on('error', (error) => reject(error instanceof SourceError ? error : unavailable(request, error)));
      req.end();
    });
  }
}

/** One joined live view: the map's events in, hook events out. */
class LiveChannel {
  private ref = 0;
  private readonly joinRef = '1';
  private readonly topic: string;
  private readonly replies = new Map<
    string,
    { resolve: (payload: Row) => void; reject: (error: Error) => void }
  >();
  private readonly mapEvents: Array<(type: string, body: unknown) => void> = [];
  private heartbeat: NodeJS.Timeout | null = null;
  private closedWith: Error | null = null;

  private constructor(
    private readonly socket: WebSocket,
    private readonly request: WandererSessionRequest,
    page: LivePage,
  ) {
    this.topic = `lv:${page.viewId}`;
  }

  static open(
    request: WandererSessionRequest,
    page: LivePage,
    options: WandererSessionOptions,
  ): Promise<LiveChannel> {
    guardAddress(request);
    const scheme = request.base.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${scheme}//${request.base.host}/live/websocket?_csrf_token=${encodeURIComponent(page.csrfToken)}&vsn=2.0.0`;
    const socket = new WebSocket(url, {
      headers: {
        cookie: `${WANDERER_SESSION_COOKIE}=${page.cookie}`,
        origin: request.base.url,
        'user-agent': USER_AGENT,
      },
      handshakeTimeout: options.pageTimeoutMs ?? 20_000,
      maxPayload: 64 * 1024 * 1024,
      ...(request.allowPrivate ? {} : { lookup: publicOnlyLookup }),
      ...(request.base.protocol === 'https:' && request.insecureTls ? { rejectUnauthorized: false } : {}),
    });
    const channel = new LiveChannel(socket, request, page);
    return new Promise<LiveChannel>((resolve, reject) => {
      socket.once('unexpected-response', (_req, response) => {
        response.resume();
        reject(
          response.statusCode === 403
            ? signedOut(request)
            : new SourceError(
                'unavailable',
                `${request.base.host} refused the live connection (${response.statusCode})`,
              ),
        );
      });
      socket.once('error', (error) =>
        reject(error instanceof SourceError ? error : unavailable(request, error)),
      );
      socket.once('open', () => {
        socket.on('message', (data) => channel.receive(String(data)));
        socket.on('close', () =>
          channel.fail(new SourceError('unavailable', `${request.base.host} closed the live connection`)),
        );
        socket.on('error', (error) => channel.fail(unavailable(request, error)));
        channel.heartbeat = setInterval(() => channel.send(null, 'phoenix', 'heartbeat', {}), HEARTBEAT_MS);
        channel.heartbeat.unref();
        channel
          .call(
            'phx_join',
            {
              url: `${request.base.url}/${request.slug}`,
              params: { _csrf_token: page.csrfToken, _track_static: [], _mounts: 0, _mount_attempts: 0 },
              session: page.session,
              static: page.static,
              sticky: false,
            },
            options.pageTimeoutMs ?? 20_000,
          )
          .then((reply) => {
            if (reply.status !== 'ok') {
              const response = isRow(reply.response) ? reply.response : {};
              throw response.reason === 'unauthorized' || response.reason === 'stale'
                ? signedOut(request)
                : isRow(response.redirect) || isRow(response.live_redirect)
                  ? noAccess(request)
                  : new SourceError(
                      'invalid',
                      `${request.base.host} would not open the map (${String(response.reason ?? 'refused')})`,
                    );
            }
            channel.events(isRow(reply.response) ? reply.response.rendered : undefined);
            resolve(channel);
          })
          .catch((error: unknown) => {
            channel.close();
            reject(error);
          });
      });
    });
  }

  /** Tells the map the client is up and waits for the whole map (`init`). */
  map(version: string | null, timeoutMs: number): Promise<Record<string, unknown>> {
    if (this.closedWith) return Promise.reject(this.closedWith);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new SourceError(
              'unavailable',
              `${this.request.base.host} did not send the map in time (the account may have no character tracked on it)`,
            ),
          ),
        timeoutMs,
      );
      this.mapEvents.push((type, body) => {
        if (type !== 'init' || !isRow(body)) return;
        clearTimeout(timer);
        resolve(body);
      });
      this.failures.push((error) => {
        clearTimeout(timer);
        reject(error);
      });
      this.send(this.joinRef, this.topic, 'event', { type: 'hook', event: 'ui_loaded', value: { version } });
    });
  }

  /** A hook event with a reply (`{:reply, map, socket}` on Wanderer's side). */
  async ask(event: string, value: unknown, timeoutMs: number): Promise<unknown> {
    const reply = await this.call('event', { type: 'hook', event, value }, timeoutMs);
    const response = isRow(reply.response) ? reply.response : {};
    this.events(response.diff);
    if (reply.status !== 'ok') throw new SourceError('invalid', `${this.request.base.host} refused ${event}`);
    // LiveView 1.x carries a hook's reply in the diff (`diff.r`); older ones beside it.
    const diff = isRow(response.diff) ? response.diff : {};
    return diff.r ?? response.r ?? null;
  }

  close(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.socket.removeAllListeners('close');
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
      this.socket.terminate();
  }

  private readonly failures: Array<(error: Error) => void> = [];

  private fail(error: Error): void {
    if (this.closedWith) return;
    this.closedWith = error;
    for (const pending of this.replies.values()) pending.reject(error);
    this.replies.clear();
    for (const failure of this.failures) failure(error);
  }

  private call(event: string, payload: unknown, timeoutMs: number): Promise<Row> {
    if (this.closedWith) return Promise.reject(this.closedWith);
    const ref = String(++this.ref + 1);
    return new Promise<Row>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.replies.delete(ref);
        reject(new SourceError('unavailable', `${this.request.base.host} did not answer ${event} in time`));
      }, timeoutMs);
      this.replies.set(ref, {
        resolve: (reply) => {
          clearTimeout(timer);
          resolve(reply);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.sendRef(this.joinRef, ref, this.topic, event, payload);
    });
  }

  private send(joinRef: string | null, topic: string, event: string, payload: unknown): void {
    this.sendRef(joinRef, String(++this.ref + 1), topic, event, payload);
  }

  private sendRef(joinRef: string | null, ref: string, topic: string, event: string, payload: unknown): void {
    if (this.socket.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify([joinRef, ref, topic, event, payload]));
  }

  private receive(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(message) || message.length !== 5) return;
    const [, ref, topic, event, payload] = message as [unknown, unknown, unknown, unknown, unknown];
    if (topic !== this.topic) return;
    if (event === 'phx_reply' && typeof ref === 'string') {
      const pending = this.replies.get(ref);
      if (pending && isRow(payload)) {
        this.replies.delete(ref);
        pending.resolve(payload);
      }
      return;
    }
    if (event === 'diff') return this.events(payload);
    if (event === 'redirect' || event === 'live_redirect') return this.fail(noAccess(this.request));
    if (event === 'phx_error' || event === 'phx_close')
      return this.fail(new SourceError('unavailable', `${this.request.base.host} closed the map`));
  }

  /** The `push_event`s a rendered page or a diff carries (`e: [[name, payload], ...]`). */
  private events(diff: unknown): void {
    if (!isRow(diff) || !Array.isArray(diff.e)) return;
    for (const entry of diff.e) {
      if (!Array.isArray(entry) || entry[0] !== 'map_event' || !isRow(entry[1])) continue;
      const { type, body } = entry[1];
      if (typeof type === 'string') for (const listener of this.mapEvents) listener(type, body);
    }
  }
}

type Row = Record<string, unknown>;

/** Reads what the map page hands its live connection; null when it is not a signed-in map page. */
export function parseLivePage(html: string, cookie: string): LivePage | null {
  const csrfToken = attribute(html.match(/<meta\b[^>]*\bname=["']csrf-token["'][^>]*>/i)?.[0], 'content');
  const main = html.match(/<div\b[^>]*\bdata-phx-main\b[^>]*>/i)?.[0];
  const viewId = attribute(main, 'id');
  const session = attribute(main, 'data-phx-session');
  const statics = attribute(main, 'data-phx-static');
  if (!csrfToken || !viewId || !session || statics === null) return null;
  const version = attribute(html.match(/<[^>]*\bdata-version=["'][^"']*["'][^>]*>/i)?.[0], 'data-version');
  return { csrfToken, viewId, session, static: statics, version, cookie };
}

/** Accepts the cookie's value, `name=value`, or a whole `Cookie:` header with it in. */
export function sessionCookie(input: string): string {
  const raw = input.trim().replace(/^cookie:\s*/i, '');
  const named = raw
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${WANDERER_SESSION_COOKIE}=`));
  const value = named ? named.slice(WANDERER_SESSION_COOKIE.length + 1) : raw;
  if (!/^[A-Za-z0-9._~%+/=-]{20,8000}$/.test(value))
    throw new SourceError('auth', `That does not look like Wanderer's ${WANDERER_SESSION_COOKIE} cookie`);
  return value;
}

/** Wanderer writes signature times as `2026/11/23 10:00:00` (UTC). */
export function wandererTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})\/(\d\d)\/(\d\d) (\d\d:\d\d:\d\d)$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}Z` : value;
}

function attribute(tag: string | undefined, name: string): string | null {
  if (!tag) return null;
  const match = tag.match(new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`, 'i'));
  const value = match ? (match[1] ?? match[2] ?? '') : null;
  return value === null ? null : decodeEntities(value);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function renewedCookie(response: IncomingMessage): string | null {
  for (const header of response.headers['set-cookie'] ?? []) {
    const [pair] = header.split(';');
    if (pair?.startsWith(`${WANDERER_SESSION_COOKIE}=`))
      return pair.slice(WANDERER_SESSION_COOKIE.length + 1);
  }
  return null;
}

function readBody(response: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        response.destroy();
        reject(new Error('page too large'));
      } else chunks.push(chunk);
    });
    response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    response.on('error', reject);
  });
}

async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await run(item);
    }
  });
  await Promise.all(workers);
}

function guardAddress(request: WandererSessionRequest): void {
  if (!request.allowPrivate && isIP(request.base.hostname) !== 0 && !isPublicAddress(request.base.hostname))
    throw privateTarget(request.base.hostname);
}

function asSession(request: SourceRequest): WandererSessionRequest {
  if (request.kind !== 'wanderer-session')
    throw new Error(`Expected a wanderer-session request, got ${request.kind}`);
  return request;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function count(rejected: Record<string, number>, what: string): void {
  rejected[what] = (rejected[what] ?? 0) + 1;
}

function signedOut(request: WandererSessionRequest): SourceError {
  return new SourceError(
    'auth',
    `${request.base.host} did not take the session cookie: it expired or was signed out. Sign in to ${request.base.host} again and paste the new ${WANDERER_SESSION_COOKIE} cookie`,
  );
}

function noAccess(request: WandererSessionRequest): SourceError {
  return new SourceError(
    'auth',
    `The signed-in account may not open the map ${request.slug} on ${request.base.host}`,
  );
}

function unavailable(request: WandererSessionRequest, error: unknown): SourceError {
  const reason =
    error instanceof Error ? ((error as NodeJS.ErrnoException).code ?? error.message) : String(error);
  return new SourceError('unavailable', `Could not reach ${request.base.host}: ${reason}`);
}
