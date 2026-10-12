import { z } from 'zod';
import * as dto from './dto/index.js';
import { EVENT_DATA_SCHEMAS } from './event-schemas.js';
import { DomainEventSchema, EVENT_TYPES } from './events.js';
import { ClientMessage, ServerMessage } from './protocol.js';
import { routes, type RouteDef } from './routes.js';
import { describeRequirement, MAP_SCOPE_RESOURCES, SCOPE_RESOURCE_LABELS } from './scopes.js';

/**
 * The OpenAPI 3.1 description of the REST API, generated from `routes.ts` and the zod schemas of
 * the DTOs (the single source of truth; nothing is written twice). Served at `/api/openapi.json`.
 *
 * Versioning (docs/api.md): `info.version` is the version of this contract, semver. Additive
 * changes raise the minor version; a breaking change ships under a new path prefix (`/api/v2`)
 * while `/api/v1` keeps working for at least six months, its operations marked `deprecated` and
 * answered with `Deprecation` and `Sunset` headers. `/api` (unversioned) is what the web app uses
 * and always follows the newest version.
 */
export const API_VERSION = '1.0.0';
/** The stable, versioned prefix integrations should use. */
export const API_V1_PREFIX = '/api/v1';

type JsonSchema = Record<string, unknown>;

/** Every zod schema the DTO modules export, by export name. */
function dtoSchemas(): Map<z.ZodType, string> {
  const names = new Map<z.ZodType, string>();
  for (const [name, value] of Object.entries(dto)) {
    if (value instanceof z.ZodType && !names.has(value)) names.set(value, name);
  }
  return names;
}

function humanize(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const TAGS: Record<string, string> = {
  health: 'Health of the instance',
  realtime: 'Snapshots of realtime streams (the WebSocket protocol is in /api/asyncapi.json)',
  auth: 'Sign-in flows (browser only)',
  accounts: 'The signed-in account',
  instance: 'Instance information',
  eve: 'EVE Online name lookups',
  discord: 'The instance Discord bot',
  discordNotify: 'Discord notifications of a map (bundled plugin)',
  admin: 'Instance administration',
  universe: 'Static game data',
  maps: 'Maps',
  systems: 'Systems on a map',
  connections: 'Connections between systems',
  routing: 'Routes, exits and hubs',
  signatures: 'Signatures',
  access: 'Access rules of a map',
  tracking: 'Character tracking',
  webhooks: 'Webhooks of a map',
  plugins: 'Plugins',
  audit: 'History and audit',
  presence: 'Presence settings',
  themes: 'Themes',
  apiKeys: 'API keys: personal access tokens and service keys',
  sharing: 'Public links of maps',
  public: 'Public maps (no sign-in)',
  docs: 'This description',
};

const ERROR_RESPONSES: Record<string, string> = {
  '400': 'Invalid request (`validation`, `bad_request`)',
  '401': 'Not signed in, or the API key is unknown, expired, revoked or used from a refused address',
  '403': 'The role or the key scopes do not allow it',
  '404': 'Not found (also maps the caller cannot see, so ids do not leak)',
  '409': 'Conflict with the current state',
  '429': 'Rate limited; retry after the `Retry-After` seconds',
};

export interface OpenApiOptions {
  /** Origin the instance is reached at, e.g. `https://map.example.com`. */
  publicUrl: string;
}

/** Converts `/api/maps/:mapId` to `/maps/{mapId}` (relative to the versioned server URL). */
export function openApiPath(path: string): string {
  return path.replace(/^\/api/, '').replace(/:([A-Za-z]+)/g, '{$1}') || '/';
}

const INTEGER_PARAMS = new Set(['solarSystemId', 'characterId']);

/** Rewrites `$defs` refs that zod emitted for registered schemas into component refs. */
function liftDefs(schema: JsonSchema, suffix: string, components: Record<string, JsonSchema>): JsonSchema {
  const defs = (schema.$defs ?? {}) as Record<string, JsonSchema>;
  delete schema.$defs;
  delete schema.$schema;
  const rewrite = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(rewrite);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        if (k === '$ref' && typeof v === 'string' && v.startsWith('#/$defs/'))
          out[k] = `#/components/schemas/${v.slice('#/$defs/'.length)}`;
        else out[k] = rewrite(v);
      }
      return out;
    }
    return node;
  };
  for (const [name, def] of Object.entries(defs)) {
    if (!components[name]) components[name] = rewrite(def) as JsonSchema;
  }
  void suffix;
  return rewrite(schema) as JsonSchema;
}

class SchemaBook {
  readonly components: Record<string, JsonSchema> = {};
  private readonly output = z.registry<{ id: string }>();
  private readonly input = z.registry<{ id: string }>();
  private readonly names: Map<z.ZodType, string>;
  /** Names whose input and output shapes differ (defaults, transforms): `<Name>Input` exists. */
  private readonly hasInput = new Set<string>();

  constructor() {
    this.names = dtoSchemas();
    for (const [schema, name] of this.names) {
      this.output.add(schema, { id: name });
      this.input.add(schema, { id: `${name}Input` });
    }
    const common = { unrepresentable: 'any' as const, cycles: 'ref' as const, reused: 'inline' as const };
    const out = z.toJSONSchema(this.output, {
      ...common,
      io: 'output',
      uri: (id) => `#/components/schemas/${id}`,
    });
    const inp = z.toJSONSchema(this.input, {
      ...common,
      io: 'input',
      uri: (id) => `#/components/schemas/${id}`,
    });
    for (const [name, schema] of Object.entries(out.schemas)) {
      const s = { ...(schema as JsonSchema) };
      delete s.$schema;
      delete s.$id;
      this.components[name] = s;
    }
    for (const [id, schema] of Object.entries(inp.schemas)) {
      const name = id.slice(0, -'Input'.length);
      const s = { ...(schema as JsonSchema) };
      delete s.$schema;
      delete s.$id;
      if (
        JSON.stringify(s) !==
        JSON.stringify(this.components[name]).replace(
          /#\/components\/schemas\/(\w+)/g,
          '#/components/schemas/$1Input',
        )
      ) {
        this.components[id] = s;
        this.hasInput.add(name);
      }
    }
    // Input schemas reference `<Name>Input`; make sure each referenced one exists.
    for (const name of this.names.values()) {
      if (!this.hasInput.has(name) && !this.components[`${name}Input`]) {
        this.components[`${name}Input`] = { $ref: `#/components/schemas/${name}` };
      }
    }
  }

  /** A schema reference or an inline schema for a route's body, query or response. */
  of(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
    const name = this.names.get(schema);
    if (name) return { $ref: `#/components/schemas/${io === 'input' ? `${name}Input` : name}` };
    const generated = z.toJSONSchema(schema, {
      metadata: io === 'input' ? this.input : this.output,
      io,
      unrepresentable: 'any',
      cycles: 'ref',
      reused: 'inline',
    }) as JsonSchema;
    return liftDefs(generated, io === 'input' ? 'Input' : '', this.components);
  }
}

function operationSecurity(route: RouteDef): Array<Record<string, string[]>> {
  const scope = route.scope;
  const scopeName = typeof scope === 'object' ? [`${scope.resource}:${scope.action}`] : [];
  if (route.auth === 'public') return scope === 'session' ? [{}, { sessionCookie: [] }] : [{}];
  if (scope === 'session') return [{ sessionCookie: [] }];
  return [{ sessionCookie: [] }, { bearerAuth: scopeName }];
}

function describeAuth(route: RouteDef): string {
  const who =
    route.auth === 'public'
      ? 'Anyone, without signing in.'
      : route.auth === 'admin'
        ? 'Instance admins (or a service key with the admin instance role).'
        : 'A signed-in account (session cookie) or an API key.';
  const role = route.mapRole ? ` At least the map role \`${route.mapRole}\` on the map in the path.` : '';
  const scope =
    route.scope === 'none'
      ? ''
      : route.scope === 'session'
        ? ' Browser sessions only: API keys are refused.'
        : ` API keys need the scope \`${describeRequirement(route.scope)}\`${
            'global' in route.scope && route.scope.global
              ? ' (the all-maps form)'
              : route.mapRole
                ? ' (or its `map:<mapId>:` form)'
                : ''
          }.`;
  return `**Who:** ${who}${role}${scope}`;
}

function parameters(route: RouteDef, book: SchemaBook): JsonSchema[] {
  const params: JsonSchema[] = [...route.path.matchAll(/:([A-Za-z]+)/g)].map(([, name]) => ({
    name,
    in: 'path',
    required: true,
    schema: INTEGER_PARAMS.has(name!) ? { type: 'integer' } : { type: 'string' },
  }));
  if (route.query) {
    const schema = book.of(route.query, 'input');
    const resolved = schema.$ref ? book.components[String(schema.$ref).split('/').pop()!] : schema;
    const target = resolved?.$ref ? book.components[String(resolved.$ref).split('/').pop()!] : resolved;
    const properties = (target?.properties ?? {}) as Record<string, JsonSchema>;
    const required = new Set((target?.required ?? []) as string[]);
    for (const [name, property] of Object.entries(properties)) {
      params.push({ name, in: 'query', required: required.has(name), schema: property });
    }
  }
  return params;
}

/** Builds the OpenAPI 3.1 document. Pure: the same routes give the same document. */
export function buildOpenApi(options: OpenApiOptions): JsonSchema {
  const book = new SchemaBook();
  const paths: Record<string, Record<string, JsonSchema>> = {};
  for (const [group, defs] of Object.entries(routes)) {
    const entries: Array<[string, RouteDef]> =
      'method' in defs ? [[group, defs as RouteDef]] : Object.entries(defs as Record<string, RouteDef>);
    for (const [key, route] of entries) {
      const path = openApiPath(route.path);
      const responses: Record<string, JsonSchema> = {};
      if (route.redirect) responses['302'] = { description: 'Redirect (browser flow)' };
      else if (route.download)
        responses['200'] = {
          description: 'A file',
          content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
        };
      else if (route.contentType)
        responses['200'] = {
          description: 'OK',
          content: { [route.contentType]: { schema: { type: 'string' } } },
        };
      else if (route.response)
        responses[route.status ?? (route.method === 'POST' ? 201 : 200)] = {
          description: 'OK',
          content: { 'application/json': { schema: book.of(route.response, 'output') } },
        };
      else responses['204'] = { description: 'Done, no content' };
      for (const [status, description] of Object.entries(ERROR_RESPONSES)) {
        if (route.auth === 'public' && (status === '401' || status === '403') && route.scope === 'none')
          continue;
        responses[status] = { $ref: `#/components/responses/Error${status}` };
        void description;
      }
      const operation: JsonSchema = {
        operationId: group === key ? group : `${group}.${key}`,
        tags: [group],
        summary:
          route.summary ??
          `${TAGS[group] ?? humanize(group)}: ${humanize(key === group ? 'get' : key).toLowerCase()}`,
        description: describeAuth(route),
        security: operationSecurity(route),
        parameters: parameters(route, book),
        responses,
        'x-darkbeacon-auth': route.auth,
        'x-darkbeacon-scope': route.scope,
        ...(route.mapRole ? { 'x-darkbeacon-map-role': route.mapRole } : {}),
        ...(route.deprecated ? { deprecated: true } : {}),
      };
      if (route.body)
        operation.requestBody = {
          required: true,
          content: { 'application/json': { schema: book.of(route.body, 'input') } },
        };
      else if (route.upload)
        operation.requestBody = {
          required: true,
          content: { [route.upload]: { schema: { type: 'string', format: 'binary' } } },
        };
      (paths[path] ??= {})[route.method.toLowerCase()] = operation;
    }
  }

  const eventSchemas: Record<string, JsonSchema> = {};
  for (const type of EVENT_TYPES) {
    eventSchemas[type] = {
      allOf: [
        { $ref: '#/components/schemas/DomainEvent' },
        {
          type: 'object',
          properties: { type: { const: type }, data: book.of(EVENT_DATA_SCHEMAS[type], 'output') },
        },
      ],
    };
  }
  book.components.DomainEvent = book.of(DomainEventSchema, 'output');

  const scopeList = [
    ...MAP_SCOPE_RESOURCES.map((r) => `- \`${r}\`: ${SCOPE_RESOURCE_LABELS[r]}`),
    `- \`account\`: ${SCOPE_RESOURCE_LABELS.account}`,
    `- \`universe\`: ${SCOPE_RESOURCE_LABELS.universe}`,
    `- \`admin\`: ${SCOPE_RESOURCE_LABELS.admin}`,
  ].join('\n');

  return {
    openapi: '3.1.0',
    info: {
      title: 'Darkbeacon API',
      version: API_VERSION,
      description: [
        'REST API of a self-hosted Darkbeacon instance (EVE Online wormhole mapper).',
        '',
        'Authenticate with `Authorization: Bearer dbk_pat_…` (a personal access token from Account → API keys) or `dbk_svc_…` (a service key from Admin → API keys). Every request runs through the same use cases and permission checks as the web app: a key acts as its owner and can only narrow what the owner may do.',
        '',
        `Scopes are \`<resource>:<action>\` on every map the principal reaches, or \`map:<mapId>:<resource>:<action>\` on one map; actions are \`read\` < \`write\` < \`manage\`, \`*\` means all. Resources:\n${scopeList}`,
        '',
        'Realtime: the WebSocket protocol at `/ws` and the webhook payloads are described in AsyncAPI at `/api/asyncapi.json`; webhook payloads are also under `webhooks` here.',
        '',
        'Versioning: this document describes `/api/v1`. Additive changes raise the minor version; breaking changes get a new prefix and the old one stays for at least six months, marked deprecated with `Deprecation`/`Sunset` headers.',
      ].join('\n'),
    },
    servers: [{ url: `${options.publicUrl}${API_V1_PREFIX}`, description: 'This instance, API version 1' }],
    tags: Object.entries(TAGS).map(([name, description]) => ({ name, description })),
    paths,
    webhooks: {
      mapEvent: {
        post: {
          summary: 'A map event, delivered to a webhook of the map',
          description:
            'The body is the event envelope. Verify `x-darkbeacon-signature: sha256=<hex>`, the HMAC-SHA256 of `<x-darkbeacon-timestamp>.<raw body>` with the webhook secret, and reject old timestamps. Retries after 10 s, 1 min, 5 min, 30 min and 2 h.',
          parameters: [
            { name: 'x-darkbeacon-signature', in: 'header', required: true, schema: { type: 'string' } },
            { name: 'x-darkbeacon-timestamp', in: 'header', required: true, schema: { type: 'string' } },
            { name: 'x-darkbeacon-event', in: 'header', required: true, schema: { type: 'string' } },
            { name: 'x-darkbeacon-delivery', in: 'header', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  oneOf: EVENT_TYPES.map((t) => ({
                    $ref: `#/components/schemas/Event_${t.replace('.', '_')}`,
                  })),
                },
              },
            },
          },
          responses: { '2XX': { description: 'Accepted; anything else is retried' } },
        },
      },
    },
    components: {
      schemas: {
        ...book.components,
        ...Object.fromEntries(
          Object.entries(eventSchemas).map(([t, s]) => [`Event_${t.replace('.', '_')}`, s]),
        ),
      },
      responses: Object.fromEntries(
        Object.entries(ERROR_RESPONSES).map(([status, description]) => [
          `Error${status}`,
          {
            description,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiErrorBody' } } },
            ...(status === '401'
              ? {
                  headers: {
                    'WWW-Authenticate': {
                      schema: { type: 'string' },
                      description: 'Bearer challenge for API keys',
                    },
                  },
                }
              : status === '429'
                ? { headers: { 'Retry-After': { schema: { type: 'integer' } } } }
                : {}),
          },
        ]),
      ),
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'dbk_pat_… or dbk_svc_…',
          description: 'An API key. The scopes listed per operation are what the key must hold.',
        },
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'dbk_session',
          description: 'The browser session of the web app (same origin only; never sent cross-origin).',
        },
      },
    },
  };
}

/** AsyncAPI 3.0: the WebSocket protocol at `/ws` and the webhook deliveries. */
export function buildAsyncApi(options: OpenApiOptions): JsonSchema {
  const book = new SchemaBook();
  const ws = options.publicUrl.replace(/^http/, 'ws');
  const messages: Record<string, JsonSchema> = {
    client: {
      name: 'ClientMessage',
      contentType: 'application/json',
      payload: book.of(ClientMessage, 'input'),
    },
    server: {
      name: 'ServerMessage',
      contentType: 'application/json',
      payload: book.of(ServerMessage, 'output'),
    },
  };
  for (const type of EVENT_TYPES) {
    messages[`event_${type.replace('.', '_')}`] = {
      name: type,
      contentType: 'application/json',
      payload: {
        allOf: [
          book.of(DomainEventSchema, 'output'),
          {
            type: 'object',
            properties: { type: { const: type }, data: book.of(EVENT_DATA_SCHEMAS[type], 'output') },
          },
        ],
      },
    };
  }
  const eventRefs = EVENT_TYPES.map((t) => ({
    $ref: `#/channels/webhook/messages/event_${t.replace('.', '_')}`,
  }));
  return {
    asyncapi: '3.0.0',
    info: {
      title: 'Darkbeacon realtime',
      version: API_VERSION,
      description: [
        'WebSocket at `/ws`: send `{op:"subscribe", stream, sinceSeq?}`; streams are `map:<mapId>`, `instance`, `audit:instance` (instance admins) and `public:<token>` (a public map, anonymous, read-only). The server replays missing events or sends one snapshot, confirms with `subscribed`, then pushes `event` messages; keep the last `seq` to resume. Browsers authenticate with the session cookie (same origin only); other clients may send `Authorization: Bearer <API key>` on the upgrade request.',
        'Presence (`presence`, `presence.leave`) is for signed-in browser sessions on map streams; anonymous public viewers never send or receive cursors.',
        'Webhooks: every map event the webhook subscribed to is POSTed as the event envelope; see the `webhook` channel.',
      ].join('\n\n'),
    },
    servers: {
      instance: { host: new URL(ws).host, protocol: ws.startsWith('wss') ? 'wss' : 'ws', pathname: '/ws' },
    },
    channels: {
      realtime: {
        address: '/ws',
        messages: { client: messages.client, server: messages.server },
      },
      webhook: {
        address: '{webhookUrl}',
        parameters: { webhookUrl: { description: 'The URL a map admin registered' } },
        messages: Object.fromEntries(Object.entries(messages).filter(([k]) => k.startsWith('event_'))),
      },
    },
    operations: {
      subscribe: {
        action: 'send',
        channel: { $ref: '#/channels/realtime' },
        messages: [{ $ref: '#/channels/realtime/messages/client' }],
      },
      receive: {
        action: 'receive',
        channel: { $ref: '#/channels/realtime' },
        messages: [{ $ref: '#/channels/realtime/messages/server' }],
      },
      deliverWebhook: { action: 'send', channel: { $ref: '#/channels/webhook' }, messages: eventRefs },
    },
    components: { schemas: book.components },
  };
}
