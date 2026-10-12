// A stand-in for a Wanderer instance's public API, serving one map (map.json) with the answer
// shapes Wanderer documents, for import tests and demos. Never used against the real service.
//
//   node tools/fake-wanderer/server.mjs            # PORT (default 4010), FAKE_WANDERER_DATA
//
// Map API key: map.json `apiKey`; the "Officers" ACL needs its own key (`acls[].key`).
// FAKE_WANDERER_RATE_LIMIT=n answers every n-th request with 429 (Retry-After: 1).
// FAKE_WANDERER_LEGACY_SIGNATURES=off answers 404 for /api/maps/:slug/signatures, so readers
// fall back to the paginated JSON:API route. Passages one by one (`/api/v1/map_chain_passages`)
// stand for an instance that offers them; Wanderer's documented API counts them only.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MINUTE = 60_000;

/** The map with its relative times (`_..._ago_min`) turned into ISO timestamps from `now`. */
export function loadMap(file = fileURLToPath(new URL('./map.json', import.meta.url)), now = Date.now()) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const iso = (ms) => new Date(ms).toISOString().replace('Z', '000Z');
  const stamp = (row) => {
    const out = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === '_inserted_ago_min') out.inserted_at = iso(now - value * MINUTE);
      else if (key === '_updated_ago_min') out.updated_at = iso(now - value * MINUTE);
      else if (key === '_end_in_min') out.end_time = iso(now + value * MINUTE);
      else if (key === '_ago') out.inserted_at = iso(now - value * MINUTE);
      else out[key] = value;
    }
    return out;
  };
  return {
    ...raw,
    systems: raw.systems.map(stamp),
    connections: raw.connections.map(stamp),
    signatures: raw.signatures.map(stamp),
    structures: raw.structures.map(stamp),
    comments: raw.comments.map(stamp),
    passages: (raw.passages ?? []).map(stamp),
  };
}

/**
 * The fake instance. `options`: `rateLimitEvery` (n-th request gets a 429), `legacySignatures`
 * (false: 404 on the legacy route), `log` (requests seen, for tests).
 */
export function createFakeWanderer(map, options = {}) {
  const seen = options.log ?? [];
  let count = 0;
  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const slugOk = (slug) => slug === map.map.slug || slug === map.map.id;
  const visible = () => map.systems.filter((s) => s.visible);
  const page = (url, rows, base) => {
    const limit = Math.min(Number(url.searchParams.get('page[limit]') ?? 50), 200);
    const offset = Number(url.searchParams.get('page[offset]') ?? 0);
    const data = rows.slice(offset, offset + limit);
    const next =
      offset + limit < rows.length ? `${base}?page[limit]=${limit}&page[offset]=${offset + limit}` : null;
    return {
      data,
      links: { self: `${base}?page[offset]=${offset}`, ...(next ? { next } : {}) },
      meta: { total: rows.length },
    };
  };

  // `include=character`: the characters the page refers to, as JSON:API `included`.
  const withCharacters = (url, body, rows) => {
    if (url.searchParams.get('include') !== 'character') return body;
    const ids = new Set(body.data.map((d) => d.relationships.character.data.id));
    const names = new Map(map.characters.map((c) => [c.eve_id, c.name]));
    const included = [];
    for (const row of rows) {
      const id = `char-${row.character_eve_id}`;
      if (!ids.has(id) || included.some((i) => i.id === id)) continue;
      included.push({
        id,
        type: 'characters',
        attributes: {
          eve_id: row.character_eve_id,
          name: row.character_name ?? names.get(row.character_eve_id) ?? null,
        },
      });
    }
    return { ...body, included };
  };

  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    seen.push(`${req.method} ${url.pathname}${url.search}`);
    if (url.pathname === '/health') return json(res, 200, { ok: true });
    count++;
    if (options.rateLimitEvery && count % options.rateLimitEvery === 0)
      return json(res, 429, { error: 'Too many requests' }, { 'retry-after': '1' });

    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const acl = /^\/api\/acls\/([^/]+)$/.exec(url.pathname);
    if (acl) {
      const found = map.acls.find((a) => a.id === decodeURIComponent(acl[1]));
      if (!found) return json(res, 404, { error: 'ACL not found' });
      const ok = found.key ? token === found.key : token === map.apiKey || token === found.key;
      if (!ok) return json(res, 401, { error: 'Unauthorized' });
      const { key: _key, members, ...rest } = found;
      return json(res, 200, {
        data: {
          ...rest,
          owner_id: 'b7a1c2d3-0000-4000-8000-0000000000aa',
          api_key: 'REDACTED',
          inserted_at: '2025-02-13T03:32:25.144403Z',
          updated_at: '2025-02-13T03:32:25.144403Z',
          members: members.map((m) => ({
            ...m,
            inserted_at: '2025-02-13T03:33:32.332598Z',
            updated_at: '2025-02-13T03:33:36.644520Z',
          })),
        },
      });
    }
    if (token !== map.apiKey) return json(res, 401, { error: 'Unauthorized' });

    const slugParam = url.searchParams.get('slug') ?? url.searchParams.get('map_id');
    const m = /^\/api\/maps\/([^/]+)\/(systems|connections|signatures|structures)$/.exec(url.pathname);
    if (m) {
      if (!slugOk(decodeURIComponent(m[1]))) return json(res, 404, { error: 'Map not found' });
      if (m[2] === 'systems')
        return json(res, 200, { data: { systems: visible(), connections: map.connections } });
      if (m[2] === 'connections') return json(res, 200, { data: map.connections });
      if (m[2] === 'signatures') {
        if (options.legacySignatures === false) return json(res, 404, { error: 'Not found' });
        return json(res, 200, { data: map.signatures });
      }
      return json(res, 200, { data: map.structures });
    }
    switch (url.pathname) {
      case '/api/map/systems':
        if (!slugOk(slugParam)) return json(res, 404, { error: 'Map not found' });
        return json(res, 200, { data: url.searchParams.get('all') === 'true' ? map.systems : visible() });
      case '/api/map/connections':
        if (!slugOk(slugParam)) return json(res, 404, { error: 'Map not found' });
        return json(res, 200, { data: map.connections });
      case '/api/map/acls':
        if (!slugOk(slugParam)) return json(res, 404, { error: 'Map not found' });
        return json(res, 200, {
          data: map.acls.map(({ id, name, description, owner_eve_id }) => ({
            id,
            name,
            description,
            owner_eve_id,
            inserted_at: '2025-02-13T03:32:25.144403Z',
            updated_at: '2025-02-13T03:32:25.144403Z',
          })),
        });
      case '/api/map/characters':
        return json(res, 200, {
          data: map.characters.map((c) => ({
            id: c.eve_id,
            character: c,
            tracked: true,
            map_id: map.map.id,
          })),
        });
      case '/api/v1/map_system_comments': {
        const body = page(
          url,
          map.comments.map((c) => ({
            id: c.id,
            type: 'map_system_comments',
            attributes: { text: c.text, inserted_at: c.inserted_at, updated_at: c.inserted_at },
            relationships: {
              system: { data: { type: 'map_systems', id: c.system_uuid } },
              character: { data: { type: 'characters', id: `char-${c.character_eve_id}` } },
            },
          })),
          '/api/v1/map_system_comments',
        );
        return json(res, 200, withCharacters(url, body, map.comments));
      }
      case '/api/v1/map_chain_passages': {
        if (options.passages === false) return json(res, 404, { error: 'Not found' });
        const body = page(
          url,
          map.passages.map(({ id, character_eve_id, ...attributes }) => ({
            id,
            type: 'map_chain_passages',
            attributes,
            relationships: { character: { data: { type: 'characters', id: `char-${character_eve_id}` } } },
          })),
          '/api/v1/map_chain_passages',
        );
        return json(res, 200, withCharacters(url, body, map.passages));
      }
      case '/api/v1/map_system_signatures':
        return json(
          res,
          200,
          page(
            url,
            map.signatures.map(({ id, system_id, ...attributes }) => ({
              id,
              type: 'map_system_signatures',
              attributes,
              relationships: { system: { data: { type: 'map_systems', id: system_id } } },
            })),
            '/api/v1/map_system_signatures',
          ),
        );
      default:
        if (url.pathname === `/api/v1/maps/${map.map.slug}`)
          return json(res, 200, {
            data: {
              id: map.map.id,
              type: 'maps',
              attributes: {
                name: map.map.name,
                slug: map.map.slug,
                description: map.map.description,
                scope: map.map.scope,
              },
            },
          });
        return json(res, 404, { error: 'Not found' });
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const map = loadMap(process.env.FAKE_WANDERER_DATA);
  const server = createFakeWanderer(map, {
    rateLimitEvery: Number(process.env.FAKE_WANDERER_RATE_LIMIT ?? 0) || undefined,
    legacySignatures: process.env.FAKE_WANDERER_LEGACY_SIGNATURES !== 'off',
  });
  const port = Number(process.env.PORT ?? 4010);
  server.listen(port, '0.0.0.0', () => {
    console.log(`fake Wanderer on :${port}, map ${map.map.slug}, key ${map.apiKey}`);
  });
}
