import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import { CharacterService } from '@darkbeacon/identity';
import {
  PublicStructureCatalog,
  STRUCTURE_SEARCH_SCOPE,
  UNIVERSE_STRUCTURES_SCOPE,
} from '@darkbeacon/routing';
import type { KnownStructuresDto, MeDto } from '@darkbeacon/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';

const PILOT = 90000001;
const JITA = 30000142;
const PERIMETER = 30000144;
const CORP = 98000001;

/** ESI's public structures and a character's structure search, as a fake network. */
const STRUCTURES: Record<number, object> = {
  1035466617946: {
    name: 'Perimeter - Trading Tower',
    owner_id: CORP,
    solar_system_id: PERIMETER,
    type_id: 35834,
  },
  1035466617947: { name: 'Perimeter - Home', owner_id: CORP, solar_system_id: PERIMETER, type_id: 35825 },
  1035466617948: {
    name: 'Perimeter » Jita - Bridge',
    owner_id: CORP,
    solar_system_id: PERIMETER,
    type_id: 35841,
  },
};

/** Known structures over HTTP: NPC stations, the public catalogue and what my characters may use. */
describeEachDialect('known structures over HTTP', (t) => {
  let app: NestFastifyApplication;
  let cookie = '';
  let searchStatus = 200;
  const asked: string[] = [];

  const fakeFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const { pathname } = new URL(url);
    asked.push(`${init?.method ?? 'GET'} ${pathname}`);
    if (pathname === '/universe/structures') return Response.json([1035466617946]);
    const structure = /^\/universe\/structures\/(\d+)$/.exec(pathname);
    if (structure) {
      const body = STRUCTURES[Number(structure[1])];
      return body ? Response.json(body) : Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (pathname === `/characters/${PILOT}/search`) {
      if (searchStatus !== 200) return Response.json({ error: 'no' }, { status: searchStatus });
      return Response.json({ structure: [1035466617946, 1035466617947, 1035466617948] });
    }
    if (pathname === '/universe/names')
      return Response.json([{ id: CORP, name: 'Trade Corp', category: 'corporation' }]);
    if (pathname === `/corporations/${CORP}`) return Response.json({ name: 'Trade Corp', ticker: 'TRADE' });
    return Response.json({ error: 'Not found' }, { status: 404 });
  };

  const get = async (url: string, as = cookie) => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url, headers: as ? { cookie: as } : {} });
    return { status: response.statusCode, body: JSON.parse(response.body) as KnownStructuresDto };
  };

  beforeEach(async () => {
    const config = {
      ...parseEnv({ NODE_ENV: 'test', DEMO_MODE: 'true' }),
      secretKey: 'x'.repeat(32),
      dataDir: '/nonexistent',
    };
    searchStatus = 200;
    asked.length = 0;
    app = await createApp(config, { database: t.db, logger: false, fetch: fakeFetch });
    await app.getHttpAdapter().getInstance().ready();
    cookie = '';
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/api/auth/dev',
        payload: { name: 'alice', character: { id: PILOT, name: 'Pilot' } },
      });
    expect((JSON.parse(response.body) as MeDto).account).toBeTruthy();
    cookie = [response.headers['set-cookie']].flat()[0]!.split(';')[0]!;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  const grant = (scopes: string[]) => {
    const characters = app.get(CharacterService);
    vi.spyOn(characters, 'scopes').mockResolvedValue(scopes);
    vi.spyOn(characters, 'accessToken').mockResolvedValue('token');
    vi.spyOn(characters, 'withScopes').mockResolvedValue(scopes.length > 0 ? [PILOT] : []);
  };

  it('wants a signed-in account and at most 25 systems', async () => {
    expect((await get(`/api/universe/structures?systems=${JITA}`, '')).status).toBe(401);
    const many = Array.from({ length: 26 }, (_, i) => 30000001 + i).join(',');
    expect((await get(`/api/universe/structures?systems=${many}`)).status).toBe(400);
    expect((await get('/api/universe/structures')).status).toBe(400);
  });

  it('lists NPC stations and says when no character may search structures', async () => {
    grant([]);
    const { status, body } = await get(`/api/universe/structures?systems=${JITA}`);
    expect(status).toBe(200);
    expect(body.access).toBe('scope');
    expect(body.structures.length).toBeGreaterThan(5);
    expect(body.structures.every((s) => s.source === 'npc' && s.solarSystemId === JITA)).toBe(true);
    expect(body.structures[0]).toMatchObject({ typeId: null, typeName: null, owner: null });
    expect(asked).toEqual([]);
  });

  it('merges the public catalogue with the structures my characters may use', async () => {
    grant([STRUCTURE_SEARCH_SCOPE, UNIVERSE_STRUCTURES_SCOPE]);
    expect(await app.get(PublicStructureCatalog).refresh()).toEqual({
      listed: 1,
      read: 1,
      removed: 0,
      failed: 0,
    });
    // Read once a day.
    expect(await app.get(PublicStructureCatalog).refresh()).toBeNull();

    const { status, body } = await get(`/api/universe/structures?systems=${PERIMETER}`);
    expect(status).toBe(200);
    expect(body.access).toBeNull();
    const structures = body.structures.filter((s) => s.source !== 'npc');
    expect(structures).toEqual([
      {
        id: 1035466617947,
        name: 'Perimeter - Home',
        solarSystemId: PERIMETER,
        typeId: 35825,
        typeName: 'Raitaru',
        owner: { id: CORP, name: 'Trade Corp', ticker: 'TRADE' },
        source: 'access',
      },
      {
        id: 1035466617946,
        name: 'Perimeter - Trading Tower',
        solarSystemId: PERIMETER,
        typeId: 35834,
        typeName: 'Keepstar',
        owner: { id: CORP, name: 'Trade Corp', ticker: 'TRADE' },
        source: 'public',
      },
    ]);
    // NPC stations come first.
    expect(body.structures.findIndex((s) => s.source !== 'npc')).toBe(
      body.structures.filter((s) => s.source === 'npc').length,
    );
    const search = asked.find((a) => a.startsWith(`GET /characters/${PILOT}/search`));
    expect(search).toBeTruthy();
  });

  it('says when EVE did not answer the search', async () => {
    grant([STRUCTURE_SEARCH_SCOPE, UNIVERSE_STRUCTURES_SCOPE]);
    searchStatus = 503;
    const { status, body } = await get(`/api/universe/structures?systems=${PERIMETER},${JITA}`);
    expect(status).toBe(200);
    expect(body.access).toBe('unavailable');
    expect(body.structures.every((s) => s.source === 'npc')).toBe(true);
  });
});
