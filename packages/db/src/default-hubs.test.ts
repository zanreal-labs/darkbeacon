import { expect, it } from 'vitest';
import { DEFAULT_MAP_HUBS, missingDefaultHubs, up } from '../migrations/routing/0003_default_hubs.js';
import { describeEachDialect } from './testing.js';

interface Tables {
  maps: {
    id: string;
    slug: string;
    name: string;
    owner_account_id: string;
    settings: string;
    labels: string;
    created_at: number;
    updated_at: number;
  };
  routing_map_hubs: { map_id: string; solar_system_id: number; position: number };
}

const JITA = 30000142;
const AMARR = 30002187;
const HOME = 31001269;

describeEachDialect('migration routing/0003_default_hubs', (t) => {
  const map = (id: string) =>
    t.db
      .db<Tables>()
      .insertInto('maps')
      .values({
        id,
        slug: id,
        name: id,
        owner_account_id: 'alice',
        settings: '{"scopes":["wormhole"]}',
        labels: '[]',
        created_at: 1,
        updated_at: 1,
      })
      .execute();
  const hubs = (mapId: string, ids: number[]) =>
    t.db
      .db<Tables>()
      .insertInto('routing_map_hubs')
      .values(ids.map((id, position) => ({ map_id: mapId, solar_system_id: id, position })))
      .execute();
  const hubsOf = async (mapId: string) =>
    (
      await t.db
        .db<Tables>()
        .selectFrom('routing_map_hubs')
        .select('solar_system_id')
        .where('map_id', '=', mapId)
        .orderBy('position')
        .execute()
    ).map((r) => Number(r.solar_system_id));

  it('adds the trade hubs a map lacks after the hubs it has, never twice', async () => {
    await map('empty');
    await map('own');
    await hubs('own', [HOME, AMARR]);
    await map('full');
    await hubs(
      'full',
      Array.from({ length: 18 }, (_, i) => 30000001 + i),
    );

    await up(t.db.db());

    expect(await hubsOf('empty')).toEqual([...DEFAULT_MAP_HUBS]);
    // The wormhole home stays first; Amarr is not doubled.
    expect(await hubsOf('own')).toEqual([HOME, AMARR, JITA, 30002659, 30002510, 30002053]);
    // Room for two more only.
    expect((await hubsOf('full')).slice(18)).toEqual([JITA, AMARR]);

    // Running it again changes nothing.
    await up(t.db.db());
    expect(await hubsOf('own')).toEqual([HOME, AMARR, JITA, 30002659, 30002510, 30002053]);
    expect(await hubsOf('full')).toHaveLength(20);
  });
});

it('ships the five trade hubs: Jita, Amarr, Dodixie, Rens, Hek', () => {
  expect(DEFAULT_MAP_HUBS).toEqual([30000142, 30002187, 30002659, 30002510, 30002053]);
  expect(missingDefaultHubs([...DEFAULT_MAP_HUBS])).toEqual([]);
});
