import { describe, expect, it } from 'vitest';
import { loadInvasionData, loadStationData, loadUniverseData } from './index.js';
import { buildStations, formatStations, npcBuyStations, planetNames, roman, stationName } from './stations.js';

describe('station names', () => {
  it('are written the way the game writes them', () => {
    expect([1, 4, 8, 9, 14, 19].map(roman)).toEqual(['I', 'IV', 'VIII', 'IX', 'XIV', 'XIX']);
    const jita = { _key: 60003760, solarSystemID: 30000142, ownerID: 1, operationID: 14, celestialIndex: 4, orbitIndex: 4, useOperationName: true };
    expect(stationName(jita, 'Jita', 'Caldari Navy', 'Assembly Plant')).toBe(
      'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
    );
    expect(stationName({ ...jita, orbitIndex: undefined }, 'Annaro', 'CBD Corporation', 'Storage')).toBe(
      'Annaro IV - CBD Corporation Storage',
    );
    expect(stationName({ ...jita, useOperationName: false }, 'Jita', 'Caldari Navy', 'Assembly Plant')).toBe(
      'Jita IV - Moon 4 - Caldari Navy',
    );
    expect(
      stationName({ ...jita, orbitIndex: undefined }, 'Amarr', 'Emperor Family', 'Academy', 'Amarr VIII (Oris)'),
    ).toBe('Amarr VIII (Oris) - Emperor Family Academy');
  });

  it('builds the places Routes By looks for', () => {
    const data = buildStations({
      meta: { buildNumber: 1 },
      stations: [
        { _key: 60000001, solarSystemID: 1, ownerID: 1000125, operationID: 33, celestialIndex: 2, orbitIndex: 1, useOperationName: true },
        { _key: 60000002, solarSystemID: 2, ownerID: 1000125, operationID: 33, celestialIndex: 1, useOperationName: true },
        { _key: 60000003, solarSystemID: 1, ownerID: 1000035, operationID: 33, celestialIndex: 1, useOperationName: true },
      ],
      operations: [{ _key: 33, operationName: { en: 'Bureau' }, services: [27] }],
      corporations: [
        { _key: 1000125, name: { en: 'CONCORD' } },
        { _key: 1000035, name: { en: 'Caldari Navy' } },
      ],
      planetNames: planetNames([{ solarSystemID: 2, celestialIndex: 1, uniqueName: { en: 'High I (Named)' } }]),
      systems: new Map([
        [1, { name: 'Low', security: 0.3 }],
        [2, { name: 'High', security: 0.9 }],
      ]),
      blueLoot: [60000003, 99],
      redLoot: [],
      buyOrdersSource: 'test',
    });
    expect(data.stations).toEqual([
      [60000001, 1, 'Low II - Moon 1 - CONCORD Bureau'],
      [60000002, 2, 'High I (Named) - CONCORD Bureau'],
      [60000003, 1, 'Low I - Caldari Navy Bureau'],
    ]);
    // Security offices: CONCORD and DED stations in low-sec only.
    expect(data.places.securityOffice).toEqual([60000001]);
    expect(data.places.blueLoot).toEqual([60000003]);
    expect(JSON.parse(formatStations(data))).toEqual(data);
  });

  it('finds NPC buy orders (365 days, at an NPC station)', async () => {
    const pages: Record<string, unknown> = {
      'https://esi.evetech.net/markets/1/orders/?order_type=buy&type_id=5&page=1': [
        { location_id: 60000001, duration: 365, is_buy_order: true },
        { location_id: 60000002, duration: 90, is_buy_order: true },
        { location_id: 1035466617946, duration: 365, is_buy_order: true },
      ],
    };
    expect(await npcBuyStations([5], [1, 2], async (url) => pages[url] ?? [])).toEqual([60000001]);
  });
});

describe('the committed station and invasion data', () => {
  const universe = loadUniverseData();
  const byId = new Map(universe.systems.map((s) => [s.id, s]));
  const stations = loadStationData();
  const systemOf = new Map(stations.stations.map(([id, system]) => [id, system]));

  it('names the trade hubs main stations', () => {
    const names = new Map(stations.stations.map(([id, , name]) => [id, name]));
    expect(stations.places.tradeHubs.map((id) => names.get(id))).toEqual([
      'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
      'Rens VI - Moon 8 - Brutor Tribe Treasury',
      'Hek VIII - Moon 12 - Boundless Creation Factory',
      'Amarr VIII (Oris) - Emperor Family Academy',
      'Dodixie IX - Moon 20 - Federation Navy Assembly Plant',
    ]);
  });

  it('has security offices in 32 low-sec systems', () => {
    const systems = new Set(stations.places.securityOffice.map((id) => systemOf.get(id)!));
    expect(systems.size).toBe(32);
    for (const id of systems) expect(byId.get(id)!.security).toBeLessThan(0.45);
  });

  it('has loot buyers in known space', () => {
    expect(stations.places.blueLoot.length).toBeGreaterThan(100);
    expect(stations.places.redLoot.length).toBeGreaterThan(100);
  });

  it('lists 137 EDENCOM, 28 Triglavian and the 27 Pochven systems', () => {
    const invasions = loadInvasionData();
    expect([invasions.edencom.length, invasions.triglavian.length, invasions.final.length]).toEqual([137, 28, 27]);
    for (const id of invasions.final) expect(byId.get(id)!.regionId).toBe(10000070);
  });
});
