import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EVENT_TYPES } from './events.js';
import { buildAsyncApi, buildOpenApi, openApiPath } from './openapi.js';
import { routes, type RouteDef } from './routes.js';

const doc = buildOpenApi({ publicUrl: 'https://map.example.com' }) as {
  openapi: string;
  info: { version: string };
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: { schemas: Record<string, unknown> };
  webhooks: Record<string, unknown>;
};

function allRoutes(): Array<[string, RouteDef]> {
  return Object.entries(routes).flatMap(([group, defs]) =>
    'method' in defs
      ? [[group, defs as RouteDef] as [string, RouteDef]]
      : Object.entries(defs as Record<string, RouteDef>).map(
          ([k, r]) => [`${group}.${k}`, r] as [string, RouteDef],
        ),
  );
}

/** Every `$ref` in the document points at something that exists. */
function danglingRefs(node: unknown, root: Record<string, unknown>, found: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => danglingRefs(n, root, found));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string' && v.startsWith('#/')) {
        let at: unknown = root;
        for (const part of v.slice(2).split('/')) at = (at as Record<string, unknown> | undefined)?.[part];
        if (at === undefined) found.push(v);
      } else danglingRefs(v, root, found);
    }
  }
  return found;
}

describe('OpenAPI description', () => {
  it('is OpenAPI 3.1 for the versioned prefix', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.servers[0]!.url).toBe('https://map.example.com/api/v1');
    expect(doc.info.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('documents every route with its schemas, auth and scope', () => {
    const missing: string[] = [];
    for (const [name, route] of allRoutes()) {
      const op = doc.paths[openApiPath(route.path)]?.[route.method.toLowerCase()] as
        Record<string, unknown> | undefined;
      if (!op) {
        missing.push(`${name}: no operation`);
        continue;
      }
      if (!op['x-darkbeacon-scope']) missing.push(`${name}: no scope`);
      if (!(op.security as unknown[] | undefined)?.length) missing.push(`${name}: no security`);
      const responses = op.responses as Record<string, unknown>;
      const ok =
        responses['200'] ?? responses['201'] ?? responses['202'] ?? responses['204'] ?? responses['302'];
      if (!ok) missing.push(`${name}: no success response`);
      // A JSON answer must come with its schema; only 204s, redirects and files have none.
      if (
        !route.response &&
        !route.redirect &&
        !route.download &&
        !route.contentType &&
        route.method === 'GET'
      )
        missing.push(`${name}: GET without a response schema`);
      if (['POST', 'PUT', 'PATCH'].includes(route.method) && route.body && !op.requestBody)
        missing.push(`${name}: body not documented`);
    }
    expect(missing).toEqual([]);
  });

  it('has no dangling references and describes every webhook event', () => {
    expect(danglingRefs(doc, doc as unknown as Record<string, unknown>)).toEqual([]);
    for (const type of EVENT_TYPES)
      expect(doc.components.schemas[`Event_${type.replace('.', '_')}`]).toBeDefined();
    expect(doc.webhooks.mapEvent).toBeDefined();
  });

  it('names reusable DTOs as components', () => {
    expect(doc.components.schemas.MapDto).toBeDefined();
    expect(doc.components.schemas.ApiKeyDto).toBeDefined();
    const list = doc.paths['/maps']!.get!.responses as Record<
      string,
      { content: Record<string, { schema: unknown }> }
    >;
    expect(JSON.stringify(list['200']!.content['application/json']!.schema)).toContain(
      '#/components/schemas/MapSummaryDto',
    );
  });

  it('serializes to JSON and back', () => {
    expect(() => z.record(z.string(), z.unknown()).parse(JSON.parse(JSON.stringify(doc)))).not.toThrow();
  });
});

describe('AsyncAPI description', () => {
  it('describes the WebSocket protocol and webhooks without dangling references', () => {
    const async = buildAsyncApi({ publicUrl: 'https://map.example.com' }) as Record<string, unknown>;
    expect(async.asyncapi).toBe('3.0.0');
    expect(danglingRefs(async, async)).toEqual([]);
  });
});
