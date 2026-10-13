// A stand-in for a Wanderer instance (our fork: upstream v1.103 with its additions), serving one
// map for import tests and demos. map.json holds the map as Wanderer's database keeps it (table
// rows: raw names, status numbers as the app stores them, internal character ids); the routes
// answer exactly like the real ones, field for field, as recorded from a running instance in
// recorded/answers.json (a contract test compares the two). Never used against the real service.
//
//   node tools/fake-wanderer/server.mjs            # PORT (default 4010), FAKE_WANDERER_DATA
//
// Map API key: map.json `apiKey`. ACL members come over JSON:API with the map key; `/api/acls/:id`
// wants the ACL's own key (`acls[].key`), as in Wanderer.
// FAKE_WANDERER_RATE_LIMIT=n answers every n-th request with 429 (Retry-After: 1).
// FAKE_WANDERER_EXPORT=off answers 404 for /api/maps/:map/export (instances without it).
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
      else if (key === '_ago') out.inserted_at = out.updated_at = iso(now - value * MINUTE);
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

// ---- Wanderer's serializers -----------------------------------------------------------------------

/** `APIUtils.map_system_to_json`: `name` is what is shown, `custom_name` resolved, `original_name`. */
export function systemJson(s) {
  const original = s.original_name ?? `System ${s.solar_system_id}`;
  const renamed = s.name && s.name !== original ? s.name : null;
  const shown = s.temporary_name || s.custom_name || renamed || original;
  return {
    id: s.id,
    name: shown,
    status: s.status,
    tag: s.tag,
    visible: s.visible,
    description: s.description,
    labels: s.labels,
    locked: s.locked,
    map_id: s.map_id,
    solar_system_id: s.solar_system_id,
    inserted_at: s.inserted_at,
    updated_at: s.updated_at,
    temporary_name: s.temporary_name,
    position_y: s.position_y,
    position_x: s.position_x,
    custom_name: renamed ?? s.custom_name,
    original_name: original,
  };
}

/** `APIUtils.connection_to_json`: no notes, marks or passage counts. */
export function connectionJson(c) {
  return {
    id: c.id,
    type: c.type,
    locked: c.locked,
    map_id: c.map_id,
    mass_status: c.mass_status,
    ship_size_type: c.ship_size_type,
    time_status: c.time_status,
    inserted_at: c.inserted_at,
    updated_at: c.updated_at,
    solar_system_target: c.solar_system_target,
    solar_system_source: c.solar_system_source,
    wormhole_type: c.wormhole_type,
  };
}

const SIGNATURE_FIELDS = [
  'id',
  'name',
  'type',
  'description',
  'group',
  'kind',
  'deleted',
  'inserted_at',
  'updated_at',
  'eve_id',
  'system_id',
  'custom_info',
  'temporary_name',
  'character_eve_id',
  'linked_system_id',
  'update_forced_at',
];

/** `Operations.list_signatures`: the struct dumped as it is, `system_id` swapped for the solar id. */
function signatureJson(g, solarSystemId) {
  return {
    id: g.id,
    name: g.name,
    type: g.type,
    description: g.description,
    group: g.group,
    kind: g.kind,
    deleted: g.deleted,
    solar_system_id: solarSystemId,
    inserted_at: g.inserted_at,
    updated_at: g.updated_at,
    __lateral_join_source__: null,
    __metadata__: { selected: SIGNATURE_FIELDS },
    __order__: null,
    eve_id: g.eve_id,
    custom_info: g.custom_info,
    temporary_name: g.temporary_name,
    character_eve_id: g.character_eve_id,
    linked_system_id: g.linked_system_id,
    update_forced_at: null,
  };
}

function structureJson(t) {
  return {
    id: t.id,
    system_id: t.system_id,
    solar_system_id: t.solar_system_id,
    solar_system_name: t.solar_system_name,
    structure_type_id: t.structure_type_id,
    structure_type: t.structure_type,
    character_eve_id: t.character_eve_id,
    name: t.name,
    notes: t.notes,
    owner_name: t.owner_name,
    owner_ticker: t.owner_ticker,
    owner_id: t.owner_id ?? null,
    status: t.status,
    end_time: t.end_time ?? null,
    inserted_at: t.inserted_at,
    updated_at: t.updated_at,
  };
}

/** `Operations.Transfer.export` (version 2): every system, hidden ones too, and their intel. */
function exportDocument(map, now) {
  const solarOf = new Map(map.systems.map((s) => [s.id, s.solar_system_id]));
  return {
    comments: map.comments.map((c) => ({ solar_system_id: solarOf.get(c.system_id), text: c.text })),
    connections: map.connections.map((c) => ({
      bubbled: c.bubbled ?? 0,
      custom_info: c.custom_info,
      dangerous: c.dangerous ?? false,
      locked: c.locked,
      mass_status: c.mass_status,
      ship_size_type: c.ship_size_type,
      source: c.solar_system_source,
      target: c.solar_system_target,
      time_status: c.time_status,
      type: c.type,
      wormhole_type: c.wormhole_type,
    })),
    exported_at: new Date(now).toISOString().replace('Z', '000Z'),
    map: {
      description: map.map.description,
      name: map.map.name,
      slug: map.map.slug,
      system_labels: map.map.system_labels ?? [],
    },
    signatures: map.signatures
      .filter((g) => !g.deleted)
      .map((g) => ({
        custom_info: g.custom_info,
        description: g.description,
        eve_id: g.eve_id,
        group: g.group,
        kind: g.kind,
        linked_system_id: g.linked_system_id,
        name: g.name,
        solar_system_id: solarOf.get(g.system_id),
        temporary_name: g.temporary_name,
        type: g.type,
      })),
    structures: map.structures.map((t) => ({
      end_time: t.end_time ?? null,
      name: t.name,
      notes: t.notes,
      owner_id: t.owner_id ?? null,
      owner_name: t.owner_name,
      owner_ticker: t.owner_ticker,
      solar_system_id: t.solar_system_id,
      solar_system_name: t.solar_system_name,
      status: t.status,
      structure_type: t.structure_type,
      structure_type_id: t.structure_type_id,
    })),
    systems: map.systems.map((s) => ({
      custom_name: s.custom_name,
      description: s.description,
      labels: s.labels,
      linked_sig_eve_id: s.linked_sig_eve_id ?? null,
      locked: s.locked,
      name: s.name,
      position: { x: s.position_x, y: s.position_y },
      solar_system_id: s.solar_system_id,
      status: s.status,
      tag: s.tag,
      temporary_name: s.temporary_name,
      visible: s.visible,
    })),
    version: 2,
  };
}

// ---- JSON:API (AshJsonApi) -------------------------------------------------------------------------

const EMPTY_REL = { links: {}, meta: {} };
const resource = (type, id, attributes, relationships = {}) => ({
  attributes,
  id,
  links: {},
  meta: {},
  type,
  relationships,
});

// ---- the server -------------------------------------------------------------------------------

/**
 * The fake instance. `options`: `rateLimitEvery` (n-th request gets a 429), `export` (false: no
 * `/api/maps/:map/export`, as upstream Wanderer), `webhooks` (false: switched off on the
 * instance), `log` (requests seen, for tests).
 */
export function createFakeWanderer(map, options = {}) {
  const seen = options.log ?? [];
  let count = 0;
  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(body));
  };
  const plain = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(body);
  };
  const isMap = (id) => id === map.map.slug || id === map.map.id;
  const shown = () => map.systems.filter((s) => s.visible);
  const shownIds = () => new Set(shown().map((s) => s.id));
  const systemById = new Map(map.systems.map((s) => [s.id, s]));
  const characterById = new Map((map.characters ?? []).map((c) => [c.id, c]));

  /** A JSON:API collection; `paged` ones answer `page[limit]`/`page[offset]` with links. */
  const collection = (req, url, rows, { paged = true, defaultLimit = 100, maxLimit = 500, included } = {}) => {
    const origin = `http://${req.headers.host}`;
    const base = `${origin}${url.pathname}`;
    const include = url.searchParams.get('include');
    const keep = include ? `include=${encodeURIComponent(include)}&` : '';
    if (!paged)
      return { data: rows, included, links: { self: `${origin}${url.pathname}${url.search}` }, meta: {}, jsonapi: { version: '1.0' } };
    const limit = Math.min(Number(url.searchParams.get('page[limit]') ?? defaultLimit), maxLimit);
    const offset = Number(url.searchParams.get('page[offset]') ?? 0);
    const data = rows.slice(offset, offset + limit);
    const at = (o) => (o > 0 ? `${base}?${keep}page[offset]=${o}&page[limit]=${limit}` : `${base}?${keep}page[limit]=${limit}`);
    return {
      data,
      ...(included ? { included: included(data) } : {}),
      links: {
        first: at(0),
        self: at(offset),
        next: offset + limit < rows.length ? at(offset + limit) : null,
        prev: offset > 0 ? at(Math.max(0, offset - limit)) : null,
      },
      meta: { page: {} },
      jsonapi: { version: '1.0' },
    };
  };
  const systemAttributes = (s) => ({
    name: s.name,
    status: s.status,
    tag: s.tag,
    description: s.description,
    labels: s.labels,
    solar_system_id: s.solar_system_id,
    temporary_name: s.temporary_name,
    custom_name: s.custom_name,
  });

  const v1 = (req, res, url) => {
    const include = (url.searchParams.get('include') ?? '').split(',').filter(Boolean);
    switch (url.pathname) {
      case `/api/v1/maps/${map.map.slug}`:
        return json(res, 200, {
          data: resource(
            'maps',
            map.map.id,
            {
              name: map.map.name,
              scope: map.map.scope,
              description: map.map.description,
              scopes: map.map.scopes ?? ['wormholes'],
              webhooks_enabled: false,
              slug: map.map.slug,
              owner_id: 'b7a1c2d3-0000-4000-8000-0000000000aa',
              personal_note: null,
              sse_enabled: false,
            },
            { owner: EMPTY_REL, characters: EMPTY_REL, acls: EMPTY_REL },
          ),
          links: { self: `http://${req.headers.host}${url.pathname}` },
          meta: {},
          jsonapi: { version: '1.0' },
        });
      case '/api/v1/map_systems':
        return json(
          res,
          200,
          collection(
            req,
            url,
            map.systems.map((s) => resource('map_systems', s.id, systemAttributes(s), { map: EMPTY_REL })),
          ),
        );
      case '/api/v1/map_connections':
        return json(
          res,
          200,
          collection(
            req,
            url,
            map.connections.map((c) =>
              resource(
                'map_connections',
                c.id,
                {
                  type: c.type,
                  locked: c.locked,
                  mass_status: c.mass_status,
                  ship_size_type: c.ship_size_type,
                  time_status: c.time_status,
                  custom_info: c.custom_info,
                  solar_system_target: c.solar_system_target,
                  solar_system_source: c.solar_system_source,
                  dangerous: c.dangerous ?? false,
                  bubbled: c.bubbled ?? 0,
                  wormhole_type: c.wormhole_type,
                  mass_status_updated_at: c.mass_status_updated_at ?? null,
                  count_of_passage: c.count_of_passage ?? 0,
                  locked_at: c.locked_at ?? null,
                },
                { map: EMPTY_REL, locked_by: EMPTY_REL },
              ),
            ),
            { paged: false },
          ),
        );
      case '/api/v1/map_system_signatures': {
        const withSystem = include.includes('system');
        return json(
          res,
          200,
          collection(
            req,
            url,
            map.signatures.map((g) =>
              resource(
                'map_system_signatures',
                g.id,
                {
                  name: g.name,
                  type: g.type,
                  description: g.description,
                  group: g.group,
                  kind: g.kind,
                  deleted: g.deleted,
                  eve_id: g.eve_id,
                  custom_info: g.custom_info,
                  temporary_name: g.temporary_name,
                  character_eve_id: g.character_eve_id,
                  linked_system_id: g.linked_system_id,
                },
                {
                  system: withSystem
                    ? { data: { id: g.system_id, type: 'map_systems' }, links: {}, meta: {} }
                    : EMPTY_REL,
                },
              ),
            ),
            {
              defaultLimit: 50,
              maxLimit: 200,
              included: withSystem
                ? (page) =>
                    [...new Set(page.map((r) => r.relationships.system.data.id))]
                      .map((id) => systemById.get(id))
                      .filter(Boolean)
                      .map((s) => resource('map_systems', s.id, systemAttributes(s), { map: EMPTY_REL }))
                : undefined,
            },
          ),
        );
      }
      case '/api/v1/map_system_structures':
        return json(
          res,
          200,
          collection(
            req,
            url,
            map.structures.map((t) =>
              resource(
                'map_system_structures',
                t.id,
                {
                  name: t.name,
                  status: t.status,
                  solar_system_id: t.solar_system_id,
                  solar_system_name: t.solar_system_name,
                  owner_id: t.owner_id ?? null,
                  character_eve_id: t.character_eve_id,
                  end_time: t.end_time ?? null,
                  notes: t.notes,
                  owner_name: t.owner_name,
                  owner_ticker: t.owner_ticker,
                  structure_type: t.structure_type,
                  structure_type_id: t.structure_type_id,
                },
                { system: EMPTY_REL },
              ),
            ),
          ),
        );
      case '/api/v1/map_system_comments': {
        // The character comes as its internal id only: Wanderer's character resource is not a
        // JSON:API type, so the included entries carry no attributes and no type.
        const rel = (name, id, type) =>
          include.includes(name) ? { data: { id, type }, links: {}, meta: {} } : EMPTY_REL;
        return json(
          res,
          200,
          collection(
            req,
            url,
            map.comments.map((c) =>
              resource(
                'map_system_comments',
                c.id,
                { text: c.text },
                { system: rel('system', c.system_id, 'map_systems'), character: rel('character', c.character_id, null) },
              ),
            ),
            {
              included: include.length
                ? (page) => [
                    ...(include.includes('character')
                      ? [...new Set(page.map((r) => r.relationships.character.data?.id))].map((id) =>
                          resource(null, id, {}),
                        )
                      : []),
                    ...(include.includes('system')
                      ? [...new Set(page.map((r) => r.relationships.system.data?.id))]
                          .map((id) => systemById.get(id))
                          .filter(Boolean)
                          .map((s) => resource('map_systems', s.id, systemAttributes(s), { map: EMPTY_REL }))
                      : []),
                  ].map((r) => ({ ...r, relationships: r.type ? r.relationships : {} }))
                : undefined,
            },
          ),
        );
      }
      case '/api/v1/map_user_settings':
        return json(
          res,
          200,
          collection(
            req,
            url,
            (map.user_settings ?? [])
              .filter((u) => u.map_id === map.map.id)
              .map((u) =>
                resource(
                  'map_user_settings',
                  `${u.map_id}-${u.id}`,
                  {
                    settings: '{}',
                    hubs: u.hubs,
                    main_character_eve_id: u.main_character_eve_id ?? null,
                    following_character_eve_id: null,
                  },
                  { map: EMPTY_REL, user: EMPTY_REL },
                ),
              ),
          ),
        );
      case '/api/v1/access_lists': {
        const withMembers = include.includes('members');
        return json(
          res,
          200,
          collection(
            req,
            url,
            map.acls.map((a) =>
              resource(
                'access_lists',
                a.id,
                { name: a.name, description: a.description },
                {
                  owner: EMPTY_REL,
                  members: withMembers
                    ? { data: a.members.map((m) => ({ id: m.id, type: 'access_list_members' })), links: {}, meta: {} }
                    : EMPTY_REL,
                },
              ),
            ),
            {
              included: withMembers
                ? (page) =>
                    page.flatMap((r) =>
                      map.acls
                        .find((a) => a.id === r.id)
                        .members.map((m) =>
                          resource(
                            'access_list_members',
                            m.id,
                            {
                              name: m.name,
                              role: m.role,
                              eve_character_id: m.eve_character_id ?? null,
                              eve_corporation_id: m.eve_corporation_id ?? null,
                              eve_alliance_id: m.eve_alliance_id ?? null,
                            },
                            { access_list: EMPTY_REL },
                          ),
                        ),
                    )
                : undefined,
            },
          ),
        );
      }
      default:
        return json(res, 404, {
          errors: [
            { code: 'no_route_found', id: 'f0000000-0000-4000-8000-000000000000', meta: {}, status: '404', title: 'NoRouteFound', detail: 'no route found' },
          ],
          jsonapi: { version: '1.0' },
        });
    }
  };

  const mapRoutes = (req, res, url, mapIdentifier, rest) => {
    if (mapIdentifier === null)
      return json(res, 400, {
        error: 'Map identifier required. Provide `map_identifier` in the path or `map_id`/`slug` in query.',
      });
    if (!isMap(mapIdentifier)) return json(res, 404, { error: `Map not found for identifier: ${mapIdentifier}` });
    const visible = shownIds();
    switch (rest) {
      case 'systems':
        return json(res, 200, {
          data: { connections: map.connections.map(connectionJson), systems: shown().map(systemJson) },
        });
      case 'connections':
        return json(res, 200, { data: map.connections.map(connectionJson) });
      case 'signatures':
        return json(res, 200, {
          data: map.signatures
            .filter((g) => !g.deleted && visible.has(g.system_id))
            .map((g) => signatureJson(g, systemById.get(g.system_id).solar_system_id)),
        });
      case 'structures':
        return json(res, 200, { data: map.structures.filter((t) => visible.has(t.system_id)).map(structureJson) });
      case 'export':
        if (options.export === false) return json(res, 404, { errors: { detail: 'Not Found' } });
        return json(res, 200, { data: exportDocument(map, Date.now()) });
      case 'tracked-characters':
      case 'characters':
        return json(res, 200, {
          data: (map.characters ?? []).map((c, i) => ({
            id: `a1a1a1a1-0000-4000-8000-${String(i).padStart(12, '0')}`,
            character: {
              name: c.name,
              alliance_ticker: null,
              alliance_id: null,
              corporation_id: null,
              corporation_ticker: null,
              eve_id: c.eve_id,
            },
            character_id: c.id,
            map_id: map.map.id,
            tracked: c.tracked ?? true,
            inserted_at: '2025-02-13T03:32:25.144403Z',
            updated_at: '2025-02-13T03:32:25.144403Z',
            followed: false,
          })),
        });
      case 'acls':
        return json(res, 200, {
          data: map.acls.map(({ id, name, description, owner_eve_id }) => ({
            id,
            name,
            description,
            inserted_at: '2025-02-13T03:32:25.144403Z',
            updated_at: '2025-02-13T03:32:25.144403Z',
            owner_eve_id,
          })),
        });
      case 'webhooks':
        if (options.webhooks === false)
          return plain(res, 403, 'Webhooks are disabled. Set WANDERER_WEBHOOKS_ENABLED=true to enable.');
        // `webhook_to_json`: the signing secret is never listed.
        return json(res, 200, {
          data: (map.webhooks ?? []).map((w) => ({
            id: w.id,
            map_id: map.map.id,
            url: w.url,
            events: w.events,
            active: w.active,
            last_delivery_at: null,
            last_error: null,
            consecutive_failures: 0,
            inserted_at: '2025-03-01T10:00:00.000000Z',
            updated_at: '2025-03-01T10:00:00.000000Z',
          })),
        });
      default:
        return json(res, 404, { errors: { detail: 'Not Found' } });
    }
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

    // CheckAclApiKey: the ACL's own key only, refusals in plain text.
    const acl = /^\/api\/acls\/([^/]+)$/.exec(url.pathname);
    if (acl) {
      if (token === null) return plain(res, 401, "Missing or invalid 'Bearer' token");
      const found = map.acls.find((a) => a.id === decodeURIComponent(acl[1]));
      if (!found) return plain(res, 404, 'ACL not found');
      if (!found.key) return plain(res, 401, 'Unauthorized (no API key set for ACL)');
      if (token !== found.key) return plain(res, 401, 'Unauthorized (invalid API key for ACL)');
      return json(res, 200, {
        data: {
          id: found.id,
          name: found.name,
          description: found.description,
          api_key: 'REDACTED',
          members: found.members.map((m) => ({
            id: m.id,
            name: m.name,
            role: m.role,
            inserted_at: '2025-02-13T03:33:32.332598Z',
            updated_at: '2025-02-13T03:33:36.644520Z',
            ...(m.eve_character_id ? { eve_character_id: m.eve_character_id } : {}),
            ...(m.eve_corporation_id ? { eve_corporation_id: m.eve_corporation_id } : {}),
            ...(m.eve_alliance_id ? { eve_alliance_id: m.eve_alliance_id } : {}),
          })),
          inserted_at: '2025-02-13T03:32:25.144403Z',
          updated_at: '2025-02-13T03:32:25.144403Z',
          owner_id: 'b7a1c2d3-0000-4000-8000-0000000000aa',
        },
      });
    }

    // CheckJsonApiAuth: the token alone picks the map.
    if (url.pathname.startsWith('/api/v1/')) {
      if (token === null) return json(res, 401, { error: 'Missing or invalid authorization header' });
      if (token !== map.apiKey) return json(res, 401, { error: 'Authentication failed' });
      return v1(req, res, url);
    }

    // CheckMapApiKey: the Bearer first, then the map, then the key.
    const newer = /^\/api\/maps\/([^/]+)\/([a-z-]+)$/.exec(url.pathname);
    const legacy = /^\/api\/map\/([a-z-]+)$/.exec(url.pathname);
    if (!newer && !legacy) return json(res, 404, { errors: { detail: 'Not Found' } });
    if (token === null) return json(res, 401, { error: "Missing or invalid 'Bearer' token" });
    const identifier = newer
      ? decodeURIComponent(newer[1])
      : (url.searchParams.get('map_id') ?? url.searchParams.get('slug'));
    if (identifier !== null && isMap(identifier) && token !== map.apiKey)
      return json(res, 401, { error: 'Unauthorized (invalid token for map)' });
    return mapRoutes(req, res, url, identifier, newer ? newer[2] : legacy[1]);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const map = loadMap(process.env.FAKE_WANDERER_DATA);
  const server = createFakeWanderer(map, {
    rateLimitEvery: Number(process.env.FAKE_WANDERER_RATE_LIMIT ?? 0) || undefined,
    export: process.env.FAKE_WANDERER_EXPORT !== 'off',
  });
  const port = Number(process.env.PORT ?? 4010);
  server.listen(port, '0.0.0.0', () => {
    console.log(`fake Wanderer on :${port}, map ${map.map.slug}, key ${map.apiKey}`);
  });
}
