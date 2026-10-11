import { http, HttpResponse, type HttpResponseResolver } from 'msw/http';
import { ws } from 'msw/ws';
import {
  ClientMessage,
  routes,
  type ApiErrorCode,
  type EventType,
  type EventPayloads,
  type MapSnapshot,
  type SignatureDto,
  type SignatureGroup,
} from '@wormwright/shared';
import { builtInThemes } from '@wormwright/theme-sdk';
import { createMockDb, UNIVERSE, type MockDb } from './data';

/**
 * A small in-memory stand-in for the server: REST routes from `routes.ts` plus the `/ws`
 * protocol. Used by `vite --mode mock` and by component tests.
 */
export function createMockApi(db: MockDb = createMockDb()) {
  const streams = new Map<string, { seq: number; events: unknown[] }>();
  const subscribers = new Map<string, Set<{ send(data: string): void }>>();
  let ids = 1000;
  const newId = (prefix: string) => `${prefix}-${++ids}`;

  const fail = (status: number, code: ApiErrorCode, message: string) =>
    HttpResponse.json({ error: { code, message } }, { status });

  function emit<K extends EventType>(mapId: string, type: K, data: EventPayloads[K]) {
    const stream = `map:${mapId}`;
    const state = streams.get(stream) ?? { seq: 0, events: [] };
    streams.set(stream, state);
    const event = {
      id: newId('evt'),
      seq: ++state.seq,
      stream,
      type,
      occurredAt: Date.now(),
      actor: { kind: 'account', id: db.me?.account.id ?? 'anon' },
      data,
      v: 1,
    };
    state.events.push(event);
    for (const client of subscribers.get(stream) ?? []) client.send(JSON.stringify({ op: 'event', event }));
  }

  function snapshot(mapId: string): MapSnapshot {
    const map = db.maps.find((m) => m.id === mapId);
    return {
      map,
      systems: db.systems.filter((s) => s.mapId === mapId),
      connections: db.connections.filter((c) => c.mapId === mapId),
      signatures: db.signatures.filter((s) => s.mapId === mapId),
      characters: db.characters,
    };
  }

  /** Wraps a resolver so it needs a signed-in account. */
  const authed =
    (resolver: HttpResponseResolver): HttpResponseResolver =>
    (info) =>
      db.me ? resolver(info) : fail(401, 'unauthenticated', 'Sign in first.');

  const param = (params: Record<string, unknown>, name: string) => String(params[name]);
  const now = () => Date.now();

  const handlers = [
    http.get(routes.health.path, () =>
      HttpResponse.json({ status: 'ok', version: 'mock', database: 'sqlite' }),
    ),
    http.get(routes.auth.providers.path, () => HttpResponse.json({ discord: true, eve: true, dev: true })),
    http.get(routes.themes.list.path, () =>
      HttpResponse.json({
        themes: builtInThemes.map((t) => ({ ...t, version: null, builtIn: true })),
        defaultThemeId: 'default',
        selectedThemeId: null,
      }),
    ),
    http.put(routes.themes.select.path, () => new HttpResponse(null, { status: 204 })),
    http.post(routes.auth.dev.path, async ({ request }) => {
      const body = (await request.json()) as { name: string; character?: { name: string } };
      const base = createMockDb().me!;
      db.me = {
        account: { ...base.account, name: body.name },
        characters: body.character
          ? [{ ...base.characters[0]!, name: body.character.name }]
          : base.characters,
      };
      return HttpResponse.json(db.me);
    }),
    http.post(routes.auth.logout.path, () => {
      db.me = null;
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(routes.auth.logoutEverywhere.path, () => {
      db.me = null;
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(
      routes.accounts.me.path,
      authed(() => HttpResponse.json(db.me)),
    ),
    http.put(
      routes.accounts.setMainCharacter.path,
      authed(async ({ request }) => {
        const { characterId } = (await request.json()) as { characterId: number };
        db.me = { ...db.me!, account: { ...db.me!.account, mainCharacterId: characterId } };
        return HttpResponse.json(db.me);
      }),
    ),
    http.delete(
      routes.accounts.unlinkCharacter.path,
      authed(({ params }) => {
        const id = Number(param(params, 'characterId'));
        db.me = { ...db.me!, characters: db.me!.characters.filter((c) => c.id !== id) };
        return new HttpResponse(null, { status: 204 });
      }),
    ),

    http.get(
      routes.admin.accounts.path,
      authed(() => HttpResponse.json(db.accounts)),
    ),
    http.put(
      routes.admin.setInstanceRole.path,
      authed(async ({ params, request }) => {
        const { role } = (await request.json()) as { role: 'admin' | 'user' };
        const account = db.accounts.find((a) => a.id === param(params, 'accountId'));
        if (!account) return fail(404, 'not_found', 'No such account.');
        account.instanceRole = role;
        return HttpResponse.json(account);
      }),
    ),

    http.get(
      routes.universe.searchSystems.path,
      authed(({ request }) => {
        const q = new URL(request.url).searchParams.get('q')?.toLowerCase() ?? '';
        return HttpResponse.json(UNIVERSE.filter((s) => s.name.toLowerCase().startsWith(q)).slice(0, 8));
      }),
    ),
    http.get(
      routes.universe.getSystem.path,
      authed(({ params }) => {
        const found = UNIVERSE.find((s) => s.id === Number(param(params, 'solarSystemId')));
        return found ? HttpResponse.json(found) : fail(404, 'not_found', 'Unknown system.');
      }),
    ),

    http.get(
      routes.maps.list.path,
      authed(() => HttpResponse.json(db.maps.map(({ id, slug, name, role }) => ({ id, slug, name, role })))),
    ),
    http.post(
      routes.maps.create.path,
      authed(async ({ request }) => {
        const body = (await request.json()) as { name: string; slug?: string };
        const slug = body.slug ?? `map-${ids + 1}`;
        if (db.maps.some((m) => m.slug === slug)) return fail(409, 'conflict', 'That address is taken.');
        const map = {
          id: newId('map'),
          slug,
          name: body.name,
          ownerAccountId: db.me!.account.id,
          settings: { scopes: ['wormhole' as const] },
          labels: [],
          createdAt: now(),
          updatedAt: now(),
          role: 'admin' as const,
        };
        db.maps.push(map);
        return HttpResponse.json(map);
      }),
    ),
    http.get(
      routes.maps.bySlug.path,
      authed(({ params }) => {
        const map = db.maps.find((m) => m.slug === param(params, 'slug'));
        return map ? HttpResponse.json(map) : fail(404, 'not_found', 'No such map.');
      }),
    ),
    http.patch(
      routes.maps.update.path,
      authed(async ({ params, request }) => {
        const map = db.maps.find((m) => m.id === param(params, 'mapId'));
        if (!map) return fail(404, 'not_found', 'No such map.');
        const body = (await request.json()) as Partial<{
          name: string;
          slug: string;
          settings: { scopes: [] };
        }>;
        Object.assign(map, {
          ...(body.name ? { name: body.name } : {}),
          ...(body.slug ? { slug: body.slug } : {}),
          ...(body.settings ? { settings: { ...map.settings, ...body.settings } } : {}),
          updatedAt: now(),
        });
        emit(map.id, 'map.settings_changed', map);
        return HttpResponse.json(map);
      }),
    ),
    http.delete(
      routes.maps.remove.path,
      authed(({ params }) => {
        db.maps = db.maps.filter((m) => m.id !== param(params, 'mapId'));
        return new HttpResponse(null, { status: 204 });
      }),
    ),
    http.put(
      routes.maps.setLabels.path,
      authed(async ({ params, request }) => {
        const map = db.maps.find((m) => m.id === param(params, 'mapId'));
        if (!map) return fail(404, 'not_found', 'No such map.');
        map.labels = ((await request.json()) as { labels: typeof map.labels }).labels;
        emit(map.id, 'labels.changed', { labels: map.labels });
        return HttpResponse.json(map.labels);
      }),
    ),

    http.post(
      routes.systems.add.path,
      authed(async ({ params, request }) => {
        const mapId = param(params, 'mapId');
        const body = (await request.json()) as { solarSystemId: number; position?: { x: number; y: number } };
        if (!UNIVERSE.some((u) => u.id === body.solarSystemId))
          return fail(404, 'not_found', 'Unknown system.');
        if (db.systems.some((s) => s.mapId === mapId && s.solarSystemId === body.solarSystemId)) {
          return fail(409, 'conflict', 'The system is already on the map.');
        }
        const system = {
          mapId,
          solarSystemId: body.solarSystemId,
          position: body.position ?? { x: 0, y: 0 },
          customName: null,
          temporaryName: null,
          tag: null,
          status: 'unknown' as const,
          description: '',
          labelIds: [],
          locked: false,
          visible: true,
          createdAt: now(),
          updatedAt: now(),
        };
        db.systems.push(system);
        emit(mapId, 'system.added', system);
        return HttpResponse.json(system);
      }),
    ),
    http.post(
      routes.systems.move.path,
      authed(async ({ params, request }) => {
        const mapId = param(params, 'mapId');
        const { positions } = (await request.json()) as {
          positions: { solarSystemId: number; x: number; y: number }[];
        };
        for (const p of positions) {
          const system = db.systems.find((s) => s.mapId === mapId && s.solarSystemId === p.solarSystemId);
          if (!system || system.locked) continue;
          Object.assign(system, { position: { x: p.x, y: p.y }, updatedAt: now() });
          emit(mapId, 'system.updated', { ...system });
        }
        return new HttpResponse(null, { status: 204 });
      }),
    ),
    http.patch(
      routes.systems.update.path,
      authed(async ({ params, request }) => {
        const mapId = param(params, 'mapId');
        const system = db.systems.find(
          (s) => s.mapId === mapId && s.solarSystemId === Number(param(params, 'solarSystemId')),
        );
        if (!system) return fail(404, 'not_found', 'No such system on the map.');
        Object.assign(system, (await request.json()) as object, { updatedAt: now() });
        emit(mapId, 'system.updated', { ...system });
        return HttpResponse.json(system);
      }),
    ),
    http.delete(
      routes.systems.remove.path,
      authed(({ params }) => {
        const mapId = param(params, 'mapId');
        const solarSystemId = Number(param(params, 'solarSystemId'));
        const system = db.systems.find((s) => s.mapId === mapId && s.solarSystemId === solarSystemId);
        if (!system) return fail(404, 'not_found', 'No such system on the map.');
        if (system.locked) return fail(409, 'conflict', 'The system is locked.');
        for (const c of db.connections.filter(
          (c) => c.source === solarSystemId || c.target === solarSystemId,
        )) {
          db.connections = db.connections.filter((x) => x !== c);
          emit(mapId, 'connection.removed', { id: c.id });
        }
        db.systems = db.systems.filter((s) => s !== system);
        emit(mapId, 'system.removed', { solarSystemId });
        return new HttpResponse(null, { status: 204 });
      }),
    ),

    http.post(
      routes.connections.add.path,
      authed(async ({ params, request }) => {
        const mapId = param(params, 'mapId');
        const body = (await request.json()) as { source: number; target: number };
        const connection = {
          id: newId('conn'),
          mapId,
          source: body.source,
          target: body.target,
          type: 'wormhole' as const,
          timeStatus: 'normal' as const,
          massStatus: 'fresh' as const,
          shipSize: 'large' as const,
          massSaved: false,
          dangerous: false,
          bubbled: 'none' as const,
          eolAt: null,
          createdAt: now(),
          updatedAt: now(),
        };
        db.connections.push(connection);
        emit(mapId, 'connection.added', connection);
        return HttpResponse.json(connection);
      }),
    ),
    http.patch(
      routes.connections.update.path,
      authed(async ({ params, request }) => {
        const connection = db.connections.find((c) => c.id === param(params, 'connectionId'));
        if (!connection) return fail(404, 'not_found', 'No such connection.');
        const patch = (await request.json()) as { timeStatus?: string };
        Object.assign(connection, patch, { updatedAt: now() });
        if (patch.timeStatus)
          connection.eolAt = patch.timeStatus === 'eol' ? (connection.eolAt ?? now()) : null;
        emit(connection.mapId, 'connection.updated', { ...connection });
        return HttpResponse.json(connection);
      }),
    ),
    http.delete(
      routes.connections.remove.path,
      authed(({ params }) => {
        const id = param(params, 'connectionId');
        const connection = db.connections.find((c) => c.id === id);
        if (!connection) return fail(404, 'not_found', 'No such connection.');
        db.connections = db.connections.filter((c) => c !== connection);
        emit(connection.mapId, 'connection.removed', { id });
        return new HttpResponse(null, { status: 204 });
      }),
    ),

    http.get(
      routes.signatures.list.path,
      authed(({ params }) =>
        HttpResponse.json(
          db.signatures.filter(
            (s) =>
              s.mapId === param(params, 'mapId') &&
              s.solarSystemId === Number(param(params, 'solarSystemId')),
          ),
        ),
      ),
    ),
    http.post(
      routes.signatures.paste.path,
      authed(async ({ params, request }) => {
        const mapId = param(params, 'mapId');
        const solarSystemId = Number(param(params, 'solarSystemId'));
        const { text, mode } = (await request.json()) as { text: string; mode?: 'merge' | 'replace' };
        const result = { added: 0, updated: 0, removed: 0, skipped: [] as string[] };
        const seen = new Set<string>();
        for (const line of text.split(/\r?\n/).filter((l) => l.trim())) {
          const parsed = parseScannerLine(line);
          if (!parsed) {
            result.skipped.push(line);
            continue;
          }
          seen.add(parsed.eveId);
          const existing = db.signatures.find(
            (s) => s.mapId === mapId && s.solarSystemId === solarSystemId && s.eveId === parsed.eveId,
          );
          if (existing) {
            Object.assign(existing, {
              group: parsed.group === 'unknown' ? existing.group : parsed.group,
              name: parsed.name ?? existing.name,
              updatedAt: now(),
            });
            result.updated++;
            emit(mapId, 'signature.updated', { ...existing });
          } else {
            const sig: SignatureDto = {
              id: newId('sig'),
              mapId,
              solarSystemId,
              eveId: parsed.eveId,
              group: parsed.group,
              type: null,
              name: parsed.name,
              description: '',
              connectionId: null,
              createdAt: now(),
              updatedAt: now(),
            };
            db.signatures.push(sig);
            result.added++;
            emit(mapId, 'signature.added', sig);
          }
        }
        if (mode === 'replace') {
          for (const s of db.signatures.filter(
            (s) => s.mapId === mapId && s.solarSystemId === solarSystemId && !seen.has(s.eveId),
          )) {
            db.signatures = db.signatures.filter((x) => x !== s);
            result.removed++;
            emit(mapId, 'signature.removed', { id: s.id, solarSystemId });
          }
        }
        return HttpResponse.json(result);
      }),
    ),
    http.patch(
      routes.signatures.update.path,
      authed(async ({ params, request }) => {
        const sig = db.signatures.find((s) => s.id === param(params, 'signatureId'));
        if (!sig) return fail(404, 'not_found', 'No such signature.');
        Object.assign(sig, (await request.json()) as object, { updatedAt: now() });
        emit(sig.mapId, 'signature.updated', { ...sig });
        return HttpResponse.json(sig);
      }),
    ),
    http.delete(
      routes.signatures.remove.path,
      authed(({ params }) => {
        const sig = db.signatures.find((s) => s.id === param(params, 'signatureId'));
        if (!sig) return fail(404, 'not_found', 'No such signature.');
        db.signatures = db.signatures.filter((s) => s !== sig);
        emit(sig.mapId, 'signature.removed', { id: sig.id, solarSystemId: sig.solarSystemId });
        return new HttpResponse(null, { status: 204 });
      }),
    ),

    http.get(
      routes.access.list.path,
      authed(({ params }) => HttpResponse.json(db.rules.filter((r) => r.mapId === param(params, 'mapId')))),
    ),
    http.post(
      routes.access.add.path,
      authed(async ({ params, request }) => {
        const body = (await request.json()) as Omit<(typeof db.rules)[number], 'id' | 'mapId' | 'createdAt'>;
        const rule = {
          ...body,
          guildId: body.guildId ?? null,
          id: newId('rule'),
          mapId: param(params, 'mapId'),
          createdAt: now(),
        };
        db.rules.push(rule);
        return HttpResponse.json(rule);
      }),
    ),
    http.delete(
      routes.access.remove.path,
      authed(({ params }) => {
        db.rules = db.rules.filter((r) => r.id !== param(params, 'ruleId'));
        return new HttpResponse(null, { status: 204 });
      }),
    ),

    http.get(
      routes.tracking.characters.path,
      authed(() => HttpResponse.json(db.characters)),
    ),
    http.put(
      routes.tracking.set.path,
      authed(async ({ request }) => {
        const { characterId, tracked } = (await request.json()) as { characterId: number; tracked: boolean };
        const mine = db.me!.characters.find((c) => c.id === characterId);
        db.characters = db.characters.filter((c) => c.characterId !== characterId);
        if (tracked && mine) {
          db.characters.push({
            characterId,
            accountId: db.me!.account.id,
            name: mine.name,
            solarSystemId: null,
            shipTypeId: null,
            shipName: null,
            online: false,
            updatedAt: now(),
          });
        }
        return new HttpResponse(null, { status: 204 });
      }),
    ),

    http.get(
      routes.plugins.list.path,
      authed(() => HttpResponse.json(db.plugins)),
    ),
    http.put(
      routes.plugins.setEnabled.path,
      authed(async ({ params, request }) => {
        const plugin = db.plugins.find((p) => p.id === param(params, 'pluginId'));
        if (!plugin) return fail(404, 'not_found', 'No such plugin.');
        plugin.enabled = ((await request.json()) as { enabled: boolean }).enabled;
        return HttpResponse.json(plugin);
      }),
    ),
    http.get(
      routes.plugins.web.path,
      authed(() => HttpResponse.json([])),
    ),
  ];

  const socket = ws.link(/\/ws$/);
  const realtime = socket.addEventListener('connection', ({ client }) => {
    const mine = new Set<string>();
    client.addEventListener('message', (event) => {
      const parsed = ClientMessage.safeParse(JSON.parse(String(event.data)));
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.op === 'ping') return client.send(JSON.stringify({ op: 'pong' }));
      if (message.op === 'unsubscribe') {
        subscribers.get(message.stream)?.delete(client);
        mine.delete(message.stream);
        return client.send(JSON.stringify({ op: 'unsubscribed', stream: message.stream }));
      }
      const { stream } = message;
      const mapId = stream.startsWith('map:') ? stream.slice(4) : null;
      if (!mapId || !db.maps.some((m) => m.id === mapId)) {
        return client.send(
          JSON.stringify({ op: 'error', stream, code: 'unknown_stream', message: 'Unknown stream.' }),
        );
      }
      const state = streams.get(stream) ?? { seq: 0, events: [] };
      streams.set(stream, state);
      if (message.sinceSeq !== undefined && message.sinceSeq <= state.seq) {
        for (const e of state.events.slice(message.sinceSeq))
          client.send(JSON.stringify({ op: 'event', event: e }));
        client.send(JSON.stringify({ op: 'subscribed', stream, seq: state.seq, mode: 'replay' }));
      } else {
        client.send(JSON.stringify({ op: 'snapshot', stream, seq: state.seq, data: snapshot(mapId) }));
        client.send(JSON.stringify({ op: 'subscribed', stream, seq: state.seq, mode: 'snapshot' }));
      }
      if (!subscribers.has(stream)) subscribers.set(stream, new Set());
      subscribers.get(stream)!.add(client);
      mine.add(stream);
    });
    client.addEventListener('close', () => {
      for (const s of mine) subscribers.get(s)?.delete(client);
    });
  });

  return { db, handlers: [...handlers, realtime], emit };
}

const GROUPS: Record<string, SignatureGroup> = {
  wormhole: 'wormhole',
  'combat site': 'combat',
  'relic site': 'relic',
  'data site': 'data',
  'gas site': 'gas',
  'ore site': 'ore',
};

/** Enough of the probe scanner format for the mock: `ABC-123<TAB>Cosmic Signature<TAB>Group<TAB>Name<TAB>…`. */
function parseScannerLine(
  line: string,
): { eveId: string; group: SignatureGroup; name: string | null } | null {
  const cols = line.split('\t').map((c) => c.trim());
  if (!/^[A-Z]{3}-\d{3}$/.test(cols[0] ?? '')) return null;
  return {
    eveId: cols[0]!,
    group: GROUPS[(cols[2] ?? '').toLowerCase()] ?? 'unknown',
    name: cols[3] || null,
  };
}
