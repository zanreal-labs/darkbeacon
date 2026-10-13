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
  type WandererSystem,
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
  /** The answer as text (Wanderer's plugs answer refusals in plain text). */
  text: string;
  headers: IncomingMessage['headers'];
}

/** The resources of a JSON:API collection, all pages, with what they included. */
interface JsonApiCollection {
  data: unknown[];
  included: unknown[];
}

type Row = Record<string, unknown>;

const USER_AGENT = 'Darkbeacon-import (+https://github.com/darkbeacon; reads one map with its API key)';
const RETRIES_5XX = 2;
const RETRIES_429 = 3;
const MAX_PAGES = 200;
/** Page sizes of the paginated JSON:API resources (Wanderer's largest: 500 and 200). */
const PAGE = { systems: 500, signatures: 200, settings: 100 };
const quiet = () => undefined;

/**
 * Reads a map from a Wanderer instance over its API with the map's API key (Bearer). Routes and
 * answer shapes are the ones a running Wanderer answers with (recorded from our fork, upstream
 * v1.103 with its additions, in tools/fake-wanderer/recorded):
 *
 * - `/api/maps/:map/systems`: the systems shown on the map, with the connections between them
 *   (`/api/map/systems?slug=` on instances without the `/api/maps` routes);
 * - `/api/maps/:map/export`: the map's export document, the only place with the systems taken off
 *   the map (hidden) in full, their signatures, structures and comments, the connections' notes,
 *   dangerous and bubbled marks, and the map's label list;
 * - JSON:API under `/api/v1`, scoped to the key's map: every system with its Wanderer id
 *   (`map_systems`, hidden ones too), connection details (`map_connections`), every signature and
 *   structure, the comments, the ACLs with their members (`access_lists?include=members`, no ACL
 *   key needed), the map (`maps/:slug`) and the hubs users set (`map_user_settings`);
 * - `/api/maps/:map/{signatures,structures}` for the shown systems' rows with their times,
 *   `/tracked-characters` for who wrote comments, `/webhooks`, and `/api/acls/:id` with an ACL's
 *   own key where JSON:API is missing.
 *
 * Required parts (the shown systems) fail the read; the rest become warnings.
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

  async test(
    request: SourceRequest,
  ): Promise<{ systems: number; hiddenSystems: number | null; name: string | null }> {
    const api = asApi(request);
    const shown = await this.shownSystems(api);
    const shownIds = new Set(readAll(shown.rows, readSystem, 'systems', {}).map((s) => s.solarSystemId));
    const hidden = (rows: unknown) =>
      new Set(
        readAll(rows, readSystem, 'systems', {})
          .map((s) => s.solarSystemId)
          .filter((id) => !shownIds.has(id)),
      ).size;
    const listed = await this.jsonApi(api, '/api/v1/map_systems', PAGE.systems, quiet, 'Systems');
    if (listed) return { systems: shownIds.size, hiddenSystems: hidden(listed.data.map(flatten)), name: null };
    const document = await this.exportDocument(api, quiet, false);
    return {
      systems: shownIds.size,
      hiddenSystems: document ? hidden(document.systems) : null,
      name: null,
    };
  }

  async read(request: SourceRequest, onStep?: (step: string) => void): Promise<WandererMapDump> {
    const api = asApi(request);
    const now = this.options.now?.() ?? Date.now();
    const dump = emptyDump({ kind: 'wanderer-api', host: api.base.host, slug: api.slug, name: null }, now);
    const warn = (message: string) => dump.warnings.push(message);
    const slug = encodeURIComponent(api.slug);

    // Systems: the shown ones in full, the hidden ones from the export (or JSON:API) ------------
    onStep?.('systems');
    const shown = await this.shownSystems(api);
    const shownSystems = readAll(shown.rows, readSystem, 'systems', dump.rejected);
    const listed = await this.jsonApi(api, '/api/v1/map_systems', PAGE.systems, quiet, 'Systems');
    const listedSystems = listed ? readAll(listed.data.map(flatten), readSystem, 'systems', {}) : [];
    const document = await this.exportDocument(api, warn);
    const shownIds = new Set(shownSystems.map((s) => s.solarSystemId));
    const uuidOf = new Map<number, string>();
    for (const s of [...listedSystems, ...shownSystems]) if (s.uuid) uuidOf.set(s.solarSystemId, s.uuid);
    const hidden: WandererSystem[] = [];
    if (document) {
      for (const s of readAll(document.systems, readSystem, 'systems', dump.rejected))
        if (!shownIds.has(s.solarSystemId))
          hidden.push({ ...s, visible: false, uuid: uuidOf.get(s.solarSystemId) ?? null });
    } else {
      warn(
        "This Wanderer has no map export, so the map's label names cannot be read over its API: Labels come over named after their ids. Import from Wanderer's database to get them.",
      );
      if (listed) {
        for (const s of listedSystems)
          if (!shownIds.has(s.solarSystemId)) hidden.push({ ...s, visible: false, position: null });
        if (hidden.length > 0)
          warn(
            "Hidden systems came with their names, notes, labels, tag, status and intel, but without their place on the map or lock: this Wanderer's API does not give them. Import from Wanderer's database to get them.",
          );
      } else {
        warn(
          "Hidden systems cannot be read over this Wanderer's API; only the shown ones were read. Import from Wanderer's database to get them.",
        );
      }
    }
    dump.systems = [...shownSystems, ...hidden];
    const solarOf = new Map<string, number>();
    for (const s of dump.systems) if (s.uuid) solarOf.set(s.uuid, s.solarSystemId);
    /** A row with its `solar_system_id`, from its system's Wanderer id when it only has that. */
    const located = (row: unknown): unknown => {
      if (!isRow(row) || row.solar_system_id !== undefined) return row;
      const solar = typeof row.system_id === 'string' ? solarOf.get(row.system_id) : undefined;
      return solar ? { ...row, solar_system_id: solar } : row;
    };

    // Connections: the shown map's, with the details only JSON:API or the export give ------------
    onStep?.('connections');
    const connectionRows =
      shown.connections ??
      dataList(
        (await this.optional(api, `/api/maps/${slug}/connections`, quiet, 'Connections')) ??
          (await this.optional(api, `/api/map/connections?slug=${slug}`, warn, 'Connections')),
      );
    const details = await this.jsonApi(api, '/api/v1/map_connections', PAGE.systems, quiet, 'Connections');
    const detailRows = details ? details.data.map(flatten) : (document?.connections ?? []);
    const detailOf = new Map<string, Row>();
    for (const row of detailRows) {
      const pair = isRow(row) ? connectionPair(row) : null;
      if (pair && isRow(row)) detailOf.set(pair, row);
    }
    dump.connections = readAll(
      connectionRows.map((row) => {
        const pair = isRow(row) ? connectionPair(row) : null;
        const detail = pair ? detailOf.get(pair) : undefined;
        return detail && isRow(row) ? { ...detail, ...row } : row;
      }),
      readConnection,
      'connections',
      dump.rejected,
    );

    // Signatures: the shown systems' with their times, then every other one ----------------------
    onStep?.('signatures');
    const signatures = new Rows((row) => {
      const eveId = text(row.eve_id);
      const system = row.solar_system_id ?? row.system_id;
      return eveId && system !== undefined ? `${String(system)}:${eveId}` : null;
    });
    const shownSignatures = await this.optional(api, `/api/maps/${slug}/signatures`, quiet, 'Signatures');
    signatures.add(dataList(shownSignatures));
    const allSignatures = await this.jsonApi(
      api,
      '/api/v1/map_system_signatures',
      PAGE.signatures,
      quiet,
      'Signatures',
      'system',
    );
    if (allSignatures) signatures.add(allSignatures.data.map(flatten).map(located));
    else if (document) signatures.add(document.signatures);
    if (shownSignatures === null && !allSignatures && !document)
      warn('Signatures: this Wanderer does not offer them over the API');
    dump.signatures = readAll(signatures.list, readSignature, 'signatures', dump.rejected);

    // Structures -----------------------------------------------------------------------------------
    onStep?.('structures');
    const structures = new Rows(
      (row) =>
        text(row.id) ??
        `${String(row.solar_system_id)}:${String(row.structure_type_id)}:${String(row.name)}`,
    );
    const shownStructures = await this.optional(api, `/api/maps/${slug}/structures`, quiet, 'Structures');
    structures.add(dataList(shownStructures));
    const allStructures = await this.jsonApi(
      api,
      '/api/v1/map_system_structures',
      PAGE.systems,
      quiet,
      'Structures',
    );
    if (allStructures) structures.add(allStructures.data.map(flatten).map(located));
    else if (document) structures.add(document.structures);
    if (shownStructures === null && !allStructures && !document)
      warn('Structures: this Wanderer does not offer them over the API');
    dump.structures = readAll(structures.list, readStructure, 'structures', dump.rejected);

    // Comments, with who wrote them where Wanderer still tracks that pilot on the map ----------
    onStep?.('comments');
    const tracked = dataList(
      (await this.optional(api, `/api/maps/${slug}/tracked-characters`, quiet, 'Characters')) ??
        (await this.optional(api, `/api/map/characters?slug=${slug}`, quiet, 'Characters')),
    );
    dump.trackedCharacters = tracked.filter((row) => !isRow(row) || row.tracked !== false).length;
    const pilots = new Map<string, Row>();
    for (const row of tracked)
      if (isRow(row) && isRow(row.character) && typeof row.character_id === 'string')
        pilots.set(row.character_id, row.character);
    const comments = await this.jsonApi(
      api,
      '/api/v1/map_system_comments',
      PAGE.settings,
      quiet,
      'System comments',
      'system,character',
    );
    const commentRows = comments
      ? comments.data.map(flatten).map((row) => {
          if (!isRow(row)) return row;
          const pilot = typeof row.character_id === 'string' ? pilots.get(row.character_id) : undefined;
          return pilot
            ? { ...row, character_eve_id: text(pilot.eve_id), character_name: text(pilot.name) }
            : row;
        })
      : (document?.comments ?? []);
    if (!comments && !document) warn('System comments: this Wanderer does not offer them over the API');
    dump.comments = readAll(commentRows, readComment, 'comments', dump.rejected);
    // Wanderer has no route that lists passages one by one (its connections count them); export
    // files that list them bring them.

    onStep?.('access');
    dump.acls = await this.acls(api, warn);

    onStep?.('map');
    const map = await this.optional(api, `/api/v1/maps/${slug}`, quiet, 'Map');
    const attributes =
      isRow(map) && isRow(map.data) && isRow(map.data.attributes) ? map.data.attributes : {};
    const mapId = isRow(map) && isRow(map.data) ? text(map.data.id) : null;
    const exported = isRow(document?.map) ? document.map : {};
    dump.map.name = text(attributes.name) ?? text(exported.name);
    dump.map.description = text(attributes.description) ?? text(exported.description);
    dump.map.scope = text(attributes.scope);
    dump.map.scopes = Array.isArray(attributes.scopes)
      ? attributes.scopes.map(text).filter((s): s is string => s !== null)
      : null;
    // The map's own label list (the export carries it; else Wanderer's defaults).
    const options = isRow(attributes.options) ? attributes.options : null;
    dump.systemLabels = readSystemLabels(
      exported.system_labels ?? attributes.system_labels ?? options?.system_labels,
    );
    dump.labelNames = Object.fromEntries(dump.systemLabels.map((l) => [l.id, l.name]));
    dump.source.name = dump.map.name;

    // Hubs are each user's own in Wanderer; the map takes the ones its users set, most used first.
    onStep?.('hubs');
    const settings = await this.jsonApi(api, '/api/v1/map_user_settings', PAGE.settings, quiet, 'Hubs');
    dump.hubs = readUserHubs(settings ? settings.data.map(flatten) : [], mapId);

    // Webhooks need WANDERER_WEBHOOKS_ENABLED on the instance (403 without); their secrets are
    // never read: Darkbeacon signs with its own.
    onStep?.('webhooks');
    const webhooks = await this.optional(api, `/api/maps/${slug}/webhooks`, quiet, 'Webhooks');
    dump.webhooks = readAll(dataList(webhooks), readWebhook, 'webhooks', dump.rejected);
    return dump;
  }

  // ---- endpoints --------------------------------------------------------------------------------

  /** The systems shown on the map, and the connections when the same answer has them. */
  private async shownSystems(
    api: WandererApiRequest,
  ): Promise<{ rows: unknown[]; connections: unknown[] | null }> {
    const slug = encodeURIComponent(api.slug);
    const newer = await this.get(api, `/api/maps/${slug}/systems`);
    if (newer.status === 200) return systemsAnswer(api, newer.body);
    if (newer.status !== 404) throw this.failure(api, newer, 'systems');
    // Wanderers without the `/api/maps/:map` routes (or a map that is not there).
    const older = await this.get(api, `/api/map/systems?slug=${slug}`);
    if (older.status === 200) return systemsAnswer(api, older.body);
    if (older.status === 404)
      throw new SourceError(
        'not_found',
        `${api.base.host} has no map “${api.slug}” that this key can read (or its public API is switched off)`,
      );
    throw this.failure(api, older, 'systems');
  }

  /**
   * The map's export document (`version`, `map`, `systems` hidden ones included, `connections`,
   * `signatures`, `comments`, `structures`); null where the instance has none.
   */
  private async exportDocument(
    api: WandererApiRequest,
    warn: (message: string) => void,
    signatures = true,
  ): Promise<{
    map: unknown;
    systems: unknown[];
    connections: unknown[];
    signatures: unknown[];
    structures: unknown[];
    comments: unknown[];
  } | null> {
    const query = signatures ? '' : '?include_signatures=false';
    const answer = await this.get(api, `/api/maps/${encodeURIComponent(api.slug)}/export${query}`);
    if (answer.status === 200) {
      const data = isRow(answer.body) && isRow(answer.body.data) ? answer.body.data : null;
      if (data && Array.isArray(data.systems))
        return {
          map: data.map,
          systems: data.systems,
          connections: list(data.connections),
          signatures: list(data.signatures),
          structures: list(data.structures),
          comments: list(data.comments),
        };
      warn('The map export did not look like Wanderer’s; hidden systems were read without it');
    } else if (answer.status !== 404) {
      warnOptional(answer, warn, 'Map export (hidden systems in full)');
    }
    return null;
  }

  /**
   * The map's ACLs, each with its members: from JSON:API with the map key (`access_lists`, which
   * includes the members of the ACLs on the key's map), else per ACL with the ACL's own key.
   */
  private async acls(api: WandererApiRequest, warn: (m: string) => void): Promise<WandererAcl[]> {
    const listed = await this.optional(
      api,
      `/api/map/acls?slug=${encodeURIComponent(api.slug)}`,
      quiet,
      'Access lists',
    );
    const collection = await this.jsonApi(api, '/api/v1/access_lists', PAGE.settings, quiet, 'ACLs', 'members');
    const membersOf = new Map<string, unknown[]>();
    const viaJsonApi: Row[] = [];
    if (collection) {
      const included = new Map<string, Row>();
      for (const item of collection.included)
        if (isRow(item) && typeof item.id === 'string') included.set(item.id, item);
      for (const resource of collection.data) {
        if (!isRow(resource) || typeof resource.id !== 'string') continue;
        const relationships = isRow(resource.relationships) ? resource.relationships : {};
        const members = isRow(relationships.members) ? relationships.members.data : null;
        membersOf.set(
          resource.id,
          (Array.isArray(members) ? members : [])
            .map((ref) => (isRow(ref) && typeof ref.id === 'string' ? included.get(ref.id) : undefined))
            .filter((m): m is Row => m !== undefined)
            .map(flatten),
        );
        viaJsonApi.push(flatten(resource) as Row);
      }
    }
    if (listed === null && !collection) {
      warn('Access lists: this Wanderer does not offer them over the API');
      return [];
    }
    const out: WandererAcl[] = [];
    for (const row of listed !== null ? dataList(listed) : viaJsonApi) {
      if (!isRow(row)) continue;
      const id = text(row.id);
      if (!id) continue;
      const name = text(row.name) ?? 'ACL';
      const known = membersOf.get(id);
      if (known) {
        out.push({ id, name, members: readAll(known, readAclMember, 'access', {}), error: null });
        continue;
      }
      const key = api.aclKeys.find((k) => k.aclId === id)?.key;
      if (!key) {
        out.push({
          id,
          name,
          members: null,
          error: 'Reading its members needs the ACL API key (from the ACL settings in Wanderer)',
        });
        continue;
      }
      const answer = await this.get(api, `/api/acls/${encodeURIComponent(id)}`, key);
      if (answer.status === 200) {
        const data = isRow(answer.body) && isRow(answer.body.data) ? answer.body.data : null;
        out.push({ id, name, members: readAll(data?.members, readAclMember, 'access', {}), error: null });
      } else if (answer.status === 401 || answer.status === 403) {
        out.push({
          id,
          name,
          members: null,
          error: /no API key set/i.test(answer.text)
            ? 'The ACL has no API key in Wanderer; generate one in its settings'
            : 'Wanderer refused the ACL API key given for it',
        });
      } else {
        out.push({ id, name, members: null, error: `Wanderer answered ${answer.status}` });
      }
    }
    return out;
  }

  /**
   * Every resource of a JSON:API collection, following `links.next` (Wanderer's paginated
   * resources give it; the others answer everything at once and give none). Null when the first
   * page did not come (with a warning through `warn`).
   */
  private async jsonApi(
    api: WandererApiRequest,
    path: string,
    limit: number,
    warn: (m: string) => void,
    what: string,
    include?: string,
  ): Promise<JsonApiCollection | null> {
    const out: JsonApiCollection = { data: [], included: [] };
    const seen = new Set<string>();
    const query = include ? `include=${include}&` : '';
    let next: string | null = `${path}?${query}page[limit]=${limit}&page[offset]=0`;
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const answer = await this.get(api, next);
      if (answer.status !== 200) {
        if (page === 0) {
          warnOptional(answer, warn, what);
          return null;
        }
        throw this.failure(api, answer, what.toLowerCase());
      }
      const body = isRow(answer.body) ? answer.body : {};
      if (!Array.isArray(body.data)) {
        if (page === 0) {
          warn(`${what} could not be read (not a JSON:API collection)`);
          return null;
        }
        break;
      }
      let fresh = 0;
      for (const resource of body.data) {
        const id = isRow(resource) ? text(resource.id) : null;
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        fresh++;
        out.data.push(resource);
      }
      if (Array.isArray(body.included)) out.included.push(...body.included);
      const link = isRow(body.links) ? text(body.links.next) : null;
      // An instance that ignores the page asks for the same rows again: stop there.
      next = link && fresh > 0 ? pathOf(link) : null;
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
            resolve({ status, body, text: raw.slice(0, 500), headers: response.headers });
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
    if (answer.status === 401 && /subscription/i.test(answer.text))
      return new SourceError(
        'auth',
        `Wanderer refused to read the map (401): its subscription is not active on ${api.base.host}`,
      );
    if (answer.status === 403 && /public api is disabled/i.test(answer.text))
      return new SourceError(
        'refused',
        `${api.base.host} has its public API switched off (403); its admin turns it on with WANDERER_PUBLIC_API_DISABLED=false`,
      );
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

  test(request: SourceRequest): Promise<{ systems: number; hiddenSystems: number | null; name: string | null }> {
    return this.read(request).then((dump) => ({
      systems: dump.systems.filter((s) => s.visible).length,
      hiddenSystems: dump.systems.filter((s) => !s.visible).length,
      name: dump.map.name,
    }));
  }

  read(request: SourceRequest): Promise<WandererMapDump> {
    if (request.kind !== 'wanderer-file') return Promise.reject(new Error('not a file'));
    return Promise.resolve().then(() => this.read_(request.document, request.fileName));
  }
}

/** Rows from several routes, the first one of each key kept (routes are asked best first). */
class Rows {
  readonly list: unknown[] = [];
  private readonly keys = new Set<string>();

  constructor(private readonly keyOf: (row: Row) => string | null) {}

  add(rows: readonly unknown[]): void {
    for (const row of rows) {
      if (!isRow(row) || row.deleted === true) continue;
      const key = this.keyOf(row);
      if (key !== null) {
        if (this.keys.has(key)) continue;
        this.keys.add(key);
      }
      this.list.push(row);
    }
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

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * A systems answer: `{ data: { systems, connections } }` (Wanderer 1.100+, on both routes) or
 * `{ data: [systems] }` (older ones).
 */
function systemsAnswer(
  api: WandererApiRequest,
  body: unknown,
): { rows: unknown[]; connections: unknown[] | null } {
  const data = isRow(body) ? body.data : null;
  if (Array.isArray(data)) return { rows: data, connections: null };
  if (isRow(data) && Array.isArray(data.systems))
    return { rows: data.systems, connections: Array.isArray(data.connections) ? data.connections : null };
  throw invalid(api, 'systems');
}

/** `<lower id>-<higher id>` of a connection row (API or export field names). */
function connectionPair(row: Row): string | null {
  const a = Number(row.solar_system_source ?? row.source);
  const b = Number(row.solar_system_target ?? row.target);
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a <= 0 || b <= 0) return null;
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/**
 * A JSON:API resource as a flat row: its attributes with `id`, `system_id` from the `system`
 * relationship and `character_id` from the `character` one (Wanderer's ids).
 */
function flatten(resource: unknown): Row {
  if (!isRow(resource)) return {};
  const attributes = isRow(resource.attributes) ? resource.attributes : {};
  const relationships = isRow(resource.relationships) ? resource.relationships : {};
  const related = (name: string) => {
    const rel = relationships[name];
    return isRow(rel) && isRow(rel.data) ? text(rel.data.id) : null;
  };
  const system = related('system');
  const character = related('character');
  return {
    id: resource.id,
    ...attributes,
    ...(system && attributes.system_id === undefined ? { system_id: system } : {}),
    ...(character && attributes.character_id === undefined ? { character_id: character } : {}),
  };
}

/**
 * The path of a `links.next`. Wanderer writes its own address into the links, which behind a
 * proxy may differ from the one Darkbeacon uses, so only the path is followed, on this instance
 * (the key never goes anywhere else).
 */
function pathOf(link: string): string | null {
  try {
    const url = new URL(link, 'http://wanderer.invalid');
    return url.pathname.startsWith('/api/v1/') ? `${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
}

function warnOptional(answer: Answer, warn: (message: string) => void, what: string): void {
  if (answer.status === 404) warn(`${what}: this Wanderer does not offer them over the API`);
  else if (answer.status === 403 && /webhooks are disabled/i.test(answer.text))
    warn(`${what}: switched off on this Wanderer`);
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
