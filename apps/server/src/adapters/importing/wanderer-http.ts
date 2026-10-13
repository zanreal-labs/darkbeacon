import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import {
  emptyDump,
  isRow,
  readAclMember,
  readAll,
  readComment,
  readConnection,
  readPassage,
  readSignature,
  readStructure,
  readSystem,
  readSystemLabels,
  readUserHubs,
  readWebhook,
  SourceError,
  text,
  type MapImportSource,
  type SourceRequest,
  type WandererAcl,
  type WandererApiRequest,
  type WandererMapDump,
} from '@darkbeacon/importing';
import { isPublicAddress } from '../notifications/http-webhook-sender.js';

export interface WandererHttpOptions {
  /** Per request. */
  timeoutMs?: number;
  /** Largest answer read (bytes). */
  maxBytes?: number;
  /** Waits (tests make them instant). */
  sleep?: (ms: number) => Promise<void>;
  /** Delay before retry `attempt` (1-based) after a 5xx or a network error. */
  retryDelayMs?: (attempt: number) => number;
  /** Longest a 429 `Retry-After` is waited out. */
  maxRetryAfterMs?: number;
  /** Least time between two requests to one instance. */
  spacingMs?: number;
  now?: () => number;
}

interface Answer {
  status: number;
  body: unknown;
  headers: IncomingMessage['headers'];
}

const USER_AGENT = 'Darkbeacon-import (+https://github.com/darkbeacon; reads one map with its API key)';
const RETRIES_5XX = 2;
const RETRIES_429 = 3;
const MAX_PAGES = 200;
const PAGE = { signatures: 200, comments: 100, passages: 200, settings: 100 };

/**
 * Reads a map from a Wanderer instance over its public API with the map's API key (Bearer).
 * Endpoints and answer shapes are the ones Wanderer documents (docs/migrate-from-wanderer.md,
 * "Sources"): the map API under `/api/map` and `/api/maps/:slug`, JSON:API v1 under `/api/v1`
 * for comments and as the fallback for signatures (offset pages), and `/api/acls/:id` for ACL
 * members. Required parts (systems) fail the read; the rest become warnings.
 *
 * Unless private networks are allowed, the instance must resolve to public addresses only; the
 * check runs in the DNS lookup of the connection itself (no rebinding between check and use), as
 * for webhooks. Redirects are refused rather than followed (the key must not travel elsewhere).
 * 429 answers are waited out (`Retry-After`), 5xx and network errors retried twice, and requests
 * to one instance are spaced out.
 */
export class WandererHttpSource implements MapImportSource {
  readonly kind = 'wanderer-api' as const;
  private readonly nextSlot = new Map<string, number>();

  constructor(private readonly options: WandererHttpOptions = {}) {}

  async test(request: SourceRequest): Promise<{ systems: number; name: string | null }> {
    const api = asApi(request);
    const systems = await this.systems(api, []);
    return { systems: systems.length, name: null };
  }

  async read(request: SourceRequest, onStep?: (step: string) => void): Promise<WandererMapDump> {
    const api = asApi(request);
    const now = this.options.now?.() ?? Date.now();
    const dump = emptyDump({ kind: 'wanderer-api', host: api.base.host, slug: api.slug, name: null }, now);
    const warn = (message: string) => dump.warnings.push(message);
    const slug = encodeURIComponent(api.slug);

    onStep?.('systems');
    const systemRows = await this.systems(api, dump.warnings);
    dump.systems = readAll(systemRows.rows, readSystem, 'systems', dump.rejected);

    onStep?.('connections');
    let connections = systemRows.connections;
    if (!connections) {
      const answer = await this.optional(api, `/api/maps/${slug}/connections`, warn, 'Connections');
      const fallback =
        answer ?? (await this.optional(api, `/api/map/connections?slug=${slug}`, warn, 'Connections'));
      connections = dataList(fallback);
    }
    dump.connections = readAll(connections, readConnection, 'connections', dump.rejected);

    onStep?.('signatures');
    const signatures = await this.optional(
      api,
      `/api/maps/${slug}/signatures`,
      () => undefined,
      'Signatures',
    );
    dump.signatures = readAll(
      signatures !== null
        ? dataList(signatures)
        : await this.jsonApiAll(api, '/api/v1/map_system_signatures', PAGE.signatures, warn, 'Signatures'),
      readSignature,
      'signatures',
      dump.rejected,
    );

    onStep?.('structures');
    dump.structures = readAll(
      dataList(await this.optional(api, `/api/maps/${slug}/structures`, warn, 'Structures')),
      readStructure,
      'structures',
      dump.rejected,
    );

    onStep?.('comments');
    dump.comments = readAll(
      await this.jsonApiAll(
        api,
        '/api/v1/map_system_comments',
        PAGE.comments,
        warn,
        'System comments',
        'character',
      ),
      readComment,
      'comments',
      dump.rejected,
    );

    // Wanderer's documented API counts passages per connection only; an instance that lists them
    // one by one (JSON:API `map_chain_passages`) gives pilot, ship and time too.
    onStep?.('passages');
    dump.passages = readAll(
      await this.jsonApiAll(
        api,
        '/api/v1/map_chain_passages',
        PAGE.passages,
        () => undefined,
        'Passages',
        'character',
      ),
      readPassage,
      'passages',
      dump.rejected,
    );

    onStep?.('access');
    dump.acls = await this.acls(api, warn);

    onStep?.('map');
    const map = await this.optional(api, `/api/v1/maps/${slug}`, () => undefined, 'Map');
    const attributes =
      isRow(map) && isRow(map.data) && isRow(map.data.attributes) ? map.data.attributes : null;
    const mapId = isRow(map) && isRow(map.data) ? text(map.data.id) : null;
    if (attributes) {
      dump.map.name = text(attributes.name);
      dump.map.description = text(attributes.description);
      dump.map.scope = text(attributes.scope);
      // The map's own label list, where the instance gives it (else Wanderer's defaults).
      const options = isRow(attributes.options) ? attributes.options : null;
      dump.systemLabels = readSystemLabels(attributes.system_labels ?? options?.system_labels);
      dump.labelNames = Object.fromEntries(dump.systemLabels.map((l) => [l.id, l.name]));
      dump.source.name = dump.map.name;
    }

    // Hubs are each user's own in Wanderer; the map takes the ones its users set, most used first.
    onStep?.('hubs');
    dump.hubs = readUserHubs(
      await this.jsonApiAll(api, '/api/v1/map_user_settings', PAGE.settings, () => undefined, 'Hubs'),
      mapId,
    );

    // Webhooks need WANDERER_WEBHOOKS_ENABLED on a self-hosted instance; without it they are
    // simply not there. Their secrets are never read: Darkbeacon signs with its own.
    onStep?.('webhooks');
    const webhooks = await this.optional(
      api,
      `/api/maps/${encodeURIComponent(mapId ?? api.slug)}/webhooks`,
      () => undefined,
      'Webhooks',
    );
    dump.webhooks = readAll(dataList(webhooks), readWebhook, 'webhooks', dump.rejected);

    const characters = await this.optional(
      api,
      `/api/map/characters?slug=${slug}`,
      () => undefined,
      'Characters',
    );
    dump.trackedCharacters = dataList(characters).length;
    return dump;
  }

  // ---- endpoints --------------------------------------------------------------------------------

  /** All systems (hidden ones too); falls back to the newer route, which lists shown ones only. */
  private async systems(
    api: WandererApiRequest,
    warnings: string[],
  ): Promise<{ rows: unknown[]; connections: unknown[] | null; length: number }> {
    const slug = encodeURIComponent(api.slug);
    const all = await this.get(api, `/api/map/systems?slug=${slug}&all=true`);
    if (all.status === 200) {
      const data = isRow(all.body) ? all.body.data : null;
      if (Array.isArray(data)) return { rows: data, connections: null, length: data.length };
      // Wanderer v1.100+ answers the old route like the new one: `{ data: { systems, connections } }`,
      // shown systems only.
      if (isRow(data) && Array.isArray(data.systems)) {
        warnings.push('This Wanderer lists shown systems only; hidden systems were not read');
        return {
          rows: data.systems,
          connections: Array.isArray(data.connections) ? data.connections : null,
          length: data.systems.length,
        };
      }
      throw invalid(api, 'systems');
    }
    if (all.status !== 404) throw this.failure(api, all, 'systems');
    const newer = await this.get(api, `/api/maps/${slug}/systems`);
    if (newer.status !== 200) {
      if (newer.status === 404)
        throw new SourceError(
          'not_found',
          `${api.base.host} has no map “${api.slug}” that this key can read (or its public API is switched off)`,
        );
      throw this.failure(api, newer, 'systems');
    }
    const data = isRow(newer.body) && isRow(newer.body.data) ? newer.body.data : null;
    if (!data || !Array.isArray(data.systems)) throw invalid(api, 'systems');
    warnings.push('This Wanderer lists shown systems only; hidden systems were not read');
    return {
      rows: data.systems,
      connections: Array.isArray(data.connections) ? data.connections : null,
      length: data.systems.length,
    };
  }

  /** The map's ACLs, each with its members (read with the ACL's own key when one was given). */
  private async acls(api: WandererApiRequest, warn: (m: string) => void): Promise<WandererAcl[]> {
    const list = await this.optional(
      api,
      `/api/map/acls?slug=${encodeURIComponent(api.slug)}`,
      warn,
      'Access lists',
    );
    const out: WandererAcl[] = [];
    for (const row of dataList(list)) {
      if (!isRow(row)) continue;
      const id = text(row.id);
      if (!id) continue;
      const name = text(row.name) ?? 'ACL';
      const key = api.aclKeys.find((k) => k.aclId === id)?.key;
      const answer = await this.get(api, `/api/acls/${encodeURIComponent(id)}`, key);
      if (answer.status === 200) {
        const data = isRow(answer.body) && isRow(answer.body.data) ? answer.body.data : null;
        const members = readAll(data?.members, readAclMember, 'access', {});
        out.push({ id, name, members, error: null });
      } else if (answer.status === 401 || answer.status === 403) {
        out.push({
          id,
          name,
          members: null,
          error: key
            ? 'Wanderer refused the ACL API key given for it'
            : 'Reading its members needs the ACL API key (from the ACL settings in Wanderer)',
        });
      } else {
        out.push({ id, name, members: null, error: `Wanderer answered ${answer.status}` });
      }
    }
    return out;
  }

  /**
   * Every resource of a JSON:API collection: `links.next` when Wanderer gives it, else
   * `page[offset]` steps until a page is not full. Resources are flattened to their attributes
   * with `id` and `system_id` (from the `system` relationship).
   */
  private async jsonApiAll(
    api: WandererApiRequest,
    path: string,
    limit: number,
    warn: (m: string) => void,
    what: string,
    include?: string,
  ): Promise<unknown[]> {
    const out: unknown[] = [];
    const query = include ? `include=${include}&` : '';
    let next: string | null = `${path}?${query}page[limit]=${limit}&page[offset]=0`;
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const answer = await this.get(api, next);
      if (answer.status !== 200) {
        if (page === 0) {
          warnOptional(answer, warn, what);
          return [];
        }
        throw this.failure(api, answer, what.toLowerCase());
      }
      const body = isRow(answer.body) ? answer.body : {};
      const data = Array.isArray(body.data) ? body.data : [];
      const included = Array.isArray(body.included) ? body.included : [];
      for (const resource of data) out.push(flatten(resource, included));
      const link = isRow(body.links) ? text(body.links.next) : null;
      if (link) next = sameOriginPath(api, link);
      else
        next =
          data.length >= limit
            ? `${path}?${query}page[limit]=${limit}&page[offset]=${(page + 1) * limit}`
            : null;
    }
    return out;
  }

  /** GET that may fail without failing the read: null (with a warning) unless it answered 200. */
  private async optional(
    api: WandererApiRequest,
    path: string,
    warn: (message: string) => void,
    what: string,
  ): Promise<unknown> {
    const answer = await this.get(api, path);
    if (answer.status === 200) return answer.body;
    warnOptional(answer, warn, what);
    return null;
  }

  // ---- HTTP -------------------------------------------------------------------------------------

  /** One GET with retries: 429 waited out, 5xx and network errors retried. */
  private async get(api: WandererApiRequest, path: string, key = api.apiKey): Promise<Answer> {
    const sleep = this.options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    let limited = 0;
    let failed = 0;
    for (;;) {
      await this.space(api, sleep);
      let answer: Answer;
      try {
        answer = await this.send(api, path, key);
      } catch (error) {
        if (error instanceof SourceError) throw error;
        if (failed++ < RETRIES_5XX) {
          await sleep(this.retryDelay(failed));
          continue;
        }
        throw new SourceError('unavailable', `${api.base.host} did not answer: ${message(error)}`);
      }
      if (answer.status === 429 && limited++ < RETRIES_429) {
        const wait = retryAfter(answer.headers['retry-after'], this.options.now?.() ?? Date.now());
        if (wait <= (this.options.maxRetryAfterMs ?? 30_000)) {
          await sleep(wait);
          continue;
        }
      }
      if (answer.status >= 500 && failed++ < RETRIES_5XX) {
        await sleep(this.retryDelay(failed));
        continue;
      }
      return answer;
    }
  }

  private retryDelay(attempt: number): number {
    return this.options.retryDelayMs?.(attempt) ?? 1000 * 2 ** (attempt - 1);
  }

  private async space(api: WandererApiRequest, sleep: (ms: number) => Promise<void>): Promise<void> {
    const spacing = this.options.spacingMs ?? 100;
    const now = Date.now();
    const at = Math.max(now, this.nextSlot.get(api.base.host) ?? 0);
    this.nextSlot.set(api.base.host, at + spacing);
    if (at > now) await sleep(at - now);
  }

  private send(api: WandererApiRequest, path: string, key: string): Promise<Answer> {
    const url = new URL(path, `${api.base.url}/`);
    if (!api.allowPrivate && isIP(api.base.hostname) !== 0 && !isPublicAddress(api.base.hostname))
      return Promise.reject(privateTarget(api.base.hostname));
    const maxBytes = this.options.maxBytes ?? 50 * 1024 * 1024;
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise<Answer>((resolve, reject) => {
      const request = send(
        url,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${key}`, accept: 'application/json', 'user-agent': USER_AGENT },
          agent: false,
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 20_000),
          ...(api.allowPrivate ? {} : { lookup: publicOnlyLookup }),
          ...(url.protocol === 'https:' && api.insecureTls ? { rejectUnauthorized: false } : {}),
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            response.resume();
            reject(
              new SourceError(
                'refused',
                `${api.base.host} redirects to ${response.headers.location ?? 'another address'}; use the address it redirects to`,
              ),
            );
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              response.destroy();
              reject(
                new SourceError(
                  'invalid',
                  `${api.base.host} sent more than ${Math.round(maxBytes / 1048576)} MB`,
                ),
              );
              return;
            }
            chunks.push(chunk);
          });
          response.on('error', reject);
          response.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let body: unknown = null;
            if (raw.trim()) {
              try {
                body = JSON.parse(raw);
              } catch {
                if (status === 200) {
                  reject(
                    new SourceError(
                      'invalid',
                      `${api.base.host} did not answer with JSON at ${url.pathname}: is it a Wanderer?`,
                    ),
                  );
                  return;
                }
              }
            }
            resolve({ status, body, headers: response.headers });
          });
        },
      );
      request.on('error', (error: NodeJS.ErrnoException) => {
        if (error instanceof SourceError) reject(error);
        else if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(error.code ?? error.message))
          reject(
            new SourceError(
              'refused',
              `The certificate of ${api.base.host} is not trusted (${error.code ?? error.message}); an instance admin can accept a self-signed one`,
            ),
          );
        else if (error.message.includes('private or local address'))
          reject(new SourceError('refused', error.message));
        else reject(error);
      });
      request.end();
    });
  }

  private failure(api: WandererApiRequest, answer: Answer, what: string): SourceError {
    if (answer.status === 401 || answer.status === 403)
      return new SourceError(
        'auth',
        `Wanderer refused the API key (${answer.status}). Copy the map API key from the map's settings in Wanderer (Public API).`,
      );
    if (answer.status === 429)
      return new SourceError(
        'rate_limited',
        `${api.base.host} asks to slow down (429); try again in a few minutes`,
      );
    if (answer.status >= 500)
      return new SourceError(
        'unavailable',
        `${api.base.host} failed to send the ${what} (${answer.status}); try again later`,
      );
    return new SourceError('invalid', `${api.base.host} answered ${answer.status} for the ${what}`);
  }
}

/** Reads uploaded Wanderer export files. */
export class WandererFileSource implements MapImportSource {
  readonly kind = 'wanderer-file' as const;

  constructor(private readonly read_: (document: unknown, fileName: string | null) => WandererMapDump) {}

  test(request: SourceRequest): Promise<{ systems: number; name: string | null }> {
    return this.read(request).then((dump) => ({ systems: dump.systems.length, name: dump.map.name }));
  }

  read(request: SourceRequest): Promise<WandererMapDump> {
    if (request.kind !== 'wanderer-file') return Promise.reject(new Error('not a file'));
    return Promise.resolve().then(() => this.read_(request.document, request.fileName));
  }
}

function asApi(request: SourceRequest): WandererApiRequest {
  if (request.kind !== 'wanderer-api') throw new Error('not an API source');
  return request;
}

/** `{ data: [...] }` -> the list; anything else -> []. */
function dataList(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  return isRow(body) && Array.isArray(body.data) ? body.data : [];
}

/**
 * A JSON:API resource as a flat row: its attributes with `id`, `system_id` from the `system`
 * relationship, and `character` (name, eve_id) from an included character.
 */
function flatten(resource: unknown, included: readonly unknown[] = []): unknown {
  if (!isRow(resource)) return resource;
  const attributes = isRow(resource.attributes) ? resource.attributes : {};
  const relationships = isRow(resource.relationships) ? resource.relationships : {};
  const related = (name: string) => {
    const rel = relationships[name];
    return isRow(rel) && isRow(rel.data) ? rel.data : null;
  };
  const system = related('system');
  const characterRef = related('character');
  const character = characterRef
    ? included.find((i) => isRow(i) && i.type === characterRef.type && i.id === characterRef.id)
    : undefined;
  const characterAttributes = isRow(character) && isRow(character.attributes) ? character.attributes : null;
  return {
    id: resource.id,
    ...attributes,
    ...(system && !attributes.system_id ? { system_id: system.id } : {}),
    ...(characterAttributes && !attributes.character ? { character: characterAttributes } : {}),
  };
}

/** A `links.next` on the same instance, as a path; anything pointing elsewhere ends the paging. */
function sameOriginPath(api: WandererApiRequest, link: string): string | null {
  try {
    const url = new URL(link, `${api.base.url}/`);
    return url.origin === new URL(api.base.url).origin ? `${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
}

function warnOptional(answer: Answer, warn: (message: string) => void, what: string): void {
  if (answer.status === 404) warn(`${what}: this Wanderer does not offer them over the API`);
  else if (answer.status === 401 || answer.status === 403)
    warn(`${what}: the map API key may not read them (${answer.status})`);
  else warn(`${what} could not be read (${answer.status})`);
}

/** `Retry-After` in seconds or as an HTTP date; 5 s when missing. */
export function retryAfter(value: string | string[] | undefined, now: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return 5_000;
  if (/^\d+(\.\d+)?$/.test(raw.trim())) return Math.ceil(Number(raw) * 1000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? 5_000 : Math.max(0, at - now);
}

function invalid(api: WandererApiRequest, what: string): SourceError {
  return new SourceError('invalid', `${api.base.host} did not answer like Wanderer's API for the ${what}`);
}

const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(
    hostname,
    options,
    (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => {
      if (error) return callback(error, address as string, family);
      const addresses = typeof address === 'string' ? [address] : address.map((a) => a.address);
      const refused = addresses.find((a) => !isPublicAddress(a));
      if (refused !== undefined)
        return callback(privateTarget(`${hostname} (${refused})`), address as string, family);
      callback(null, address as string, family);
    },
  );
};

function privateTarget(what: string): SourceError {
  return new SourceError(
    'refused',
    `${what} is a private or local address; an instance admin can allow imports from private networks`,
  );
}

function message(error: unknown): string {
  if (error instanceof Error) return (error as NodeJS.ErrnoException).code ?? error.message;
  return String(error);
}
