import { translate, type WandererDbRequest } from '@darkbeacon/importing';
import { beforeAll, describe, expect, it } from 'vitest';
import { createWandererDatabase } from '../../test-support/wanderer-db.js';
import { WandererDatabaseSource } from './wanderer-db.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("WandererDatabaseSource on a Wanderer database (our fork's tables)", () => {
  let connectionString = '';
  const source = new WandererDatabaseSource({ now: () => Date.parse('2026-10-13T12:00:00Z') });
  const request = (slug: string): WandererDbRequest => ({
    kind: 'wanderer-db',
    connectionString,
    slug,
    host: 'wanderer.example.org',
  });

  beforeAll(async () => {
    connectionString = await createWandererDatabase(url!);
  });

  it('lists the maps with their shown and hidden systems, deleted maps left out', async () => {
    expect(await source.maps(connectionString)).toEqual([
      { slug: 'shck', name: 'SHCK-WH', systems: 6, hiddenSystems: 3 },
      { slug: 'zanreal', name: 'zanreal', systems: 3, hiddenSystems: 1 },
    ]);
    expect(await source.test(request('shck'))).toEqual({ systems: 6, hiddenSystems: 3, name: 'SHCK-WH' });
    await expect(source.test(request('old-one'))).rejects.toMatchObject({ failure: 'not_found' });
  });

  it('reads the whole map: hidden systems with their intel, label names, every part', async () => {
    const steps: string[] = [];
    const dump = await source.read(request('shck'), (s) => steps.push(s));
    expect(dump.source).toEqual({
      kind: 'wanderer-db',
      host: 'wanderer.example.org',
      slug: 'shck',
      name: 'SHCK-WH',
    });
    expect(dump.map).toEqual({
      name: 'SHCK-WH',
      slug: 'shck',
      description: 'Our chain',
      scope: 'wormholes',
      scopes: ['wormholes', 'low'],
    });
    expect(dump.systemLabels!.map((l) => `${l.id}=${l.name}`)).toEqual([
      'a=WH-ST',
      'b=WH1',
      'c=WH2',
      '1=WH3',
      '2=WH4',
      '3=WH5',
      'd=WH6',
      'g=WH-HS',
    ]);
    expect(dump.systems).toHaveLength(9);
    expect(dump.systems.filter((s) => !s.visible).map((s) => s.solarSystemId)).toEqual([
      31000220, 31002385, 31002404,
    ]);
    const deadEnd = dump.systems.find((s) => s.solarSystemId === 31002385)!;
    expect(deadEnd).toMatchObject({
      uuid: 'b0000000-0000-4000-8000-000000000007',
      rawName: 'Dead end',
      description: 'Old static, Sansha fleet lives here',
      tag: 'OLD',
      status: 6,
      visible: false,
      position: { x: 720, y: 300 },
      labels: { ids: ['d'], custom: 'OLD' },
      updatedAt: Date.parse('2026-09-05T10:00:00Z'),
    });
    const home = dump.systems.find((s) => s.solarSystemId === 31002531)!;
    expect(home).toMatchObject({ status: 1, locked: true, labels: { ids: ['b'], custom: 'HOME' } });
    expect(home.updatedAt).toBe(Date.parse('2026-10-10T12:00:00.123Z'));

    expect(dump.connections).toHaveLength(4);
    expect(dump.connections[0]).toMatchObject({
      source: 31002531,
      target: 31000399,
      massStatus: 1,
      timeStatus: 4,
      locked: true,
      dangerous: true,
      bubbled: 2,
      customInfo: 'Rolled once',
      countOfPassage: 2,
      massStatusAt: Date.parse('2026-10-11T08:30:00Z'),
      insertedAt: Date.parse('2026-10-11T08:00:00Z'),
    });

    // The deleted signature stays out; the hidden system's comes with it.
    expect(dump.signatures.map((s) => `${s.solarSystemId}:${s.eveId}`).sort()).toEqual([
      '31000399:bookmark-x',
      '31002385:HID-001',
      '31002531:ABC-123',
      '31002531:QQQ-111',
      '31002531:XYZ-987',
    ]);
    expect(dump.signatures.find((s) => s.eveId === 'ABC-123')).toMatchObject({
      characterEveId: '2112625428',
      linkedSystemId: 31000399,
      temporaryName: '1a',
      insertedAt: Date.parse('2026-10-11T08:00:00Z'),
    });
    expect(dump.structures.map((s) => s.name)).toEqual(['Sansha Tower', 'Home Fort', 'Hostile Astra']);
    expect(dump.structures.find((s) => s.name === 'Hostile Astra')).toMatchObject({
      endTime: Date.parse('2026-10-14T18:30:00Z'),
      ownerId: 98000002,
      characterEveId: '2112625428',
    });
    expect(dump.comments.map((c) => [c.solarSystemId, c.text, c.authorName, c.authorEveId])).toEqual([
      [31002385, 'Do not jump in solo', 'Scout Alt', '2116161001'],
      [31002531, 'Rolled the static at 18:00', 'CCP Bartender', '2112625428'],
    ]);
    expect(dump.passages!.map((p) => [p.characterEveId, p.shipTypeId, p.at])).toEqual([
      [2112625428, 29984, Date.parse('2026-10-11T08:40:00Z')],
      [2116161001, 605, Date.parse('2026-10-11T08:45:00Z')],
    ]);
    // Only the map's own ACLs, with their members (no ACL key needed).
    expect(dump.acls.map((a) => [a.name, a.members!.length, a.error])).toEqual([
      ['Blues', 2, null],
      ['Corp', 2, null],
    ]);
    // The map's own hubs as `maps_v1.hubs` keeps them (text ids, the wormhole home included), and
    // each user's own with their main character (another map's user settings ignored).
    expect(dump.hubs).toEqual([31001269, 30000142, 30002187]);
    expect(dump.userHubs).toEqual([
      { characterEveId: 2112625428, hubs: [30002187, 30002659] },
      { characterEveId: null, hubs: [30002187] },
    ]);
    expect(dump.webhooks).toEqual([
      {
        id: expect.any(String),
        url: 'https://hooks.example.com/wanderer',
        events: ['add_system', 'map_kill'],
        active: false,
      },
    ]);
    expect(dump.trackedCharacters).toBe(1);
    expect(dump.warnings).toEqual([]);
    expect(steps).toEqual([
      'map',
      'systems',
      'connections',
      'signatures',
      'structures',
      'comments',
      'passages',
      'access',
      'hubs',
      'webhooks',
    ]);
    // Tokens and keys are never read.
    const text = JSON.stringify(dump);
    for (const secret of ['secret-token', 'never-read-key', 'acl-key-never-read', '736563726574'])
      expect(text).not.toContain(secret);
  });

  it('translates into the map Wanderer shows: label names, statuses, hidden intel', async () => {
    const dump = await source.read(request('shck'));
    const names: Record<number, string> = {
      31002531: 'J014348',
      31000399: 'J130256',
      31001924: 'J130026',
      30000142: 'Jita',
      31000005: 'Thera',
      30002187: 'Amarr',
      31002385: 'J152550',
      31002404: 'J110834',
      31000220: 'J121158',
    };
    const { plan, counts, report } = translate(dump, { systemName: (id) => names[id] ?? null });
    expect(counts).toMatchObject({
      systems: 6,
      hiddenSystems: 3,
      signatures: 5,
      structures: 3,
      comments: 2,
      passages: 2,
    });
    expect(plan.systemLabels.map((l) => l.name)).toEqual([
      'WH-ST',
      'WH1',
      'WH2',
      'WH3',
      'WH4',
      'WH5',
      'WH6',
      'WH-HS',
    ]);
    const system = (id: number) => plan.systems.find((s) => s.solarSystemId === id)!.fields;
    expect(system(31002531)).toMatchObject({
      status: 'home',
      customName: 'Home sweet home',
      customLabel: 'HOME',
      systemLabelIds: ['b'],
    });
    expect(system(31000399)).toMatchObject({ status: 'warning', systemLabelIds: ['a', '1'], labelKeys: [] });
    expect(system(31001924)).toMatchObject({ status: 'hostile', customName: 'Farm', systemLabelIds: [] });
    expect(system(30000142)).toMatchObject({ status: 'friendly', customName: null });
    expect(system(30002187)).toMatchObject({ status: 'target', labelKeys: [] });
    expect(system(31000005).status).toBe('unknown');
    expect(plan.labels.map((l) => l.name).sort()).toEqual(['FARM', 'HQ', 'Looking for', 'OLD']);
    expect(system(31002385)).toMatchObject({
      visible: false,
      customName: 'Dead end',
      description: 'Old static, Sansha fleet lives here',
      status: 'hostile',
      customLabel: 'OLD',
      systemLabelIds: ['d'],
    });
    expect(system(31002404)).toMatchObject({
      visible: false,
      customName: 'Gas',
      systemLabelIds: ['g'],
      status: 'friendly',
    });
    expect(report.some((l) => /Secondary/.test(l.what))).toBe(false);
    expect(plan.signatures.some((s) => s.solarSystemId === 31002385)).toBe(true);
  });

  it('says what is wrong with the connection, never the connection string', async () => {
    const wrong = new URL(url!);
    wrong.password = 'not-the-password';
    const refused = await source.maps(wrong.toString()).catch((e: unknown) => e);
    expect(refused).toMatchObject({ failure: 'auth' });
    expect(String((refused as Error).message)).not.toContain('not-the-password');
    const empty = await source.maps(url!).catch((e: unknown) => e);
    expect(empty).toMatchObject({ failure: 'invalid', message: expect.stringMatching(/no Wanderer maps/) });
  });
});
