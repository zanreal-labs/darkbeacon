import { afterEach, beforeEach, expect, it } from 'vitest';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type {
  AccessRuleDto,
  ConnectionDto,
  ImportMapResultDto,
  MapDto,
  MapExportDocument,
  MapSettingsExportDocument,
  SignatureDto,
} from '@darkbeacon/shared';
import { SYSTEMS } from '../../adapters/mapping/testing.js';
import { startTestApp, type TestApp } from '../../test-support/test-app.js';

/** What must survive a round trip: everything but ids, times and where it came from. */
function normalized(doc: MapExportDocument) {
  const connectionKey = new Map(doc.connections.map((c) => [c.id, `${c.source}-${c.target}`]));
  return {
    map: { ...doc.map, slug: undefined },
    systems: doc.systems
      .map(({ createdAt: _c, updatedAt: _u, ...s }) => s)
      .sort((a, b) => a.solarSystemId - b.solarSystemId),
    connections: doc.connections
      .map(({ id: _i, createdAt: _c, updatedAt: _u, ...c }) => c)
      .sort((a, b) => a.source - b.source),
    signatures: doc.signatures
      .map(({ id: _i, createdAt: _c, updatedAt: _u, connectionId, ...s }) => ({
        ...s,
        connection: connectionId ? connectionKey.get(connectionId) : null,
      }))
      .sort((a, b) => a.eveId.localeCompare(b.eveId)),
    accessRules: doc.accessRules,
  };
}

describeEachDialect('map files over HTTP', (t) => {
  let s: TestApp;

  beforeEach(async () => {
    s = await startTestApp(t.db);
  });
  afterEach(async () => {
    await s.close();
  });

  it('exports a map with everything on it and imports it again unchanged', async () => {
    const map = (await s.call('POST', '/api/maps', 'alice', { name: 'Home', description: 'Our chain' }))
      .body as MapDto;
    const base = `/api/maps/${map.id}`;
    await s.call('PUT', `${base}/labels`, 'alice', {
      labels: [{ id: 'l1', name: 'Static', color: '#ff0000', description: '' }],
    });
    for (const id of [SYSTEMS.c2, SYSTEMS.c5, SYSTEMS.c1])
      await s.call('POST', `${base}/systems`, 'alice', { solarSystemId: id });
    await s.call('PATCH', `${base}/systems/${SYSTEMS.c2}`, 'alice', {
      customName: 'Home',
      status: 'home',
      tag: 'H',
      description: '**static** C5',
      labelIds: ['l1'],
      locked: true,
    });
    const hole = (
      await s.call('POST', `${base}/connections`, 'alice', { source: SYSTEMS.c2, target: SYSTEMS.c5 })
    ).body as ConnectionDto;
    await s.call('PATCH', `${base}/connections/${hole.id}`, 'alice', {
      massStatus: 'reduced',
      timeStatus: 'eol',
    });
    const sig = (
      await s.call('POST', `${base}/systems/${SYSTEMS.c2}/signatures`, 'alice', {
        eveId: 'ABC-123',
        group: 'wormhole',
        type: 'C247',
      })
    ).body as SignatureDto;
    await s.call('PATCH', `${base}/signatures/${sig.id}`, 'alice', { connectionId: hole.id });
    await s.call('POST', `${base}/systems/${SYSTEMS.c1}/signatures`, 'alice', { eveId: 'XYZ-999' });
    // A hidden system keeps its notes and signatures; the file keeps them too.
    await s.call('PATCH', `${base}/systems/${SYSTEMS.c1}`, 'alice', { description: 'was here' });
    await s.call('DELETE', `${base}/systems/${SYSTEMS.c1}`, 'alice');
    await s.call('POST', `${base}/access-rules`, 'alice', {
      subjectKind: 'alliance',
      subjectId: '99000001',
      role: 'member',
    });

    // Viewers cannot export; managers export without rules.
    await s.call('POST', `${base}/access-rules`, 'alice', {
      subjectKind: 'account',
      subjectId: 'vic',
      role: 'viewer',
    });
    expect((await s.call('GET', `${base}/export`, 'vic')).status).toBe(403);

    const exported = await s.call('GET', `${base}/export?accessRules=true`, 'alice');
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-disposition')).toContain('home.darkbeacon-map.json');
    const doc = exported.body as MapExportDocument;
    expect(doc).toMatchObject({
      format: 'darkbeacon.map',
      version: 1,
      source: { mapId: map.id, slug: 'home' },
    });
    expect(doc.systems).toHaveLength(3);
    expect(doc.systems.find((x) => x.solarSystemId === SYSTEMS.c1)).toMatchObject({
      visible: false,
      description: 'was here',
    });
    expect(doc.accessRules).toHaveLength(2);

    // Import on another account: a new map, new ids, the same chain.
    const imported = await s.call(
      'POST',
      '/api/maps/import',
      'bob',
      { document: doc },
      {
        'content-type': 'application/vnd.darkbeacon.map+json',
      },
    );
    expect(imported).toMatchObject({
      status: 201,
      body: {
        map: { slug: 'home-2', name: 'Home' },
        systems: 3,
        connections: 1,
        signatures: 2,
        accessRules: 2,
      },
    });
    const copy = (imported.body as ImportMapResultDto).map;
    const again = (await s.call('GET', `/api/maps/${copy.id}/export?accessRules=true`, 'bob'))
      .body as MapExportDocument;
    expect(normalized(again)).toEqual(normalized(doc));
    expect(again.signatures.find((x) => x.eveId === 'ABC-123')?.connectionId).toBe(again.connections[0]!.id);

    // A file of another kind or version is refused before anything is made.
    expect(
      (await s.call('POST', '/api/maps/import', 'bob', { document: { ...doc, version: 2 } })).status,
    ).toBe(400);
    // Unknown systems are left out with what hangs on them.
    const odd = {
      ...doc,
      systems: [...doc.systems, { ...doc.systems[0]!, solarSystemId: 31999999 }],
    };
    expect(
      (await s.call('POST', '/api/maps/import', 'bob', { document: odd, name: 'Odd' })).body,
    ).toMatchObject({
      systems: 3,
      skippedSystems: [31999999],
    });
  });

  it('duplicates a map and carries settings to another map', async () => {
    const map = (await s.call('POST', '/api/maps', 'alice', { name: 'Home' })).body as MapDto;
    const base = `/api/maps/${map.id}`;
    await s.call('POST', `${base}/systems`, 'alice', { solarSystemId: SYSTEMS.c2 });
    await s.call('POST', `${base}/systems/${SYSTEMS.c2}/signatures`, 'alice', { eveId: 'ABC-123' });
    await s.call('POST', `${base}/access-rules`, 'alice', {
      subjectKind: 'account',
      subjectId: 'bob',
      role: 'member',
    });
    await s.call('PATCH', base, 'alice', {
      settings: { scopes: ['wormhole', 'low'], offlineForManagersOnly: true },
    });
    await s.call('PUT', `${base}/labels`, 'alice', {
      labels: [{ id: 'l1', name: 'Static', color: '#00ff00', description: 'x' }],
    });

    expect((await s.call('POST', `${base}/duplicate`, 'bob', { name: 'Copy' })).status).toBe(403);
    const dup = await s.call('POST', `${base}/duplicate`, 'alice', { name: 'Copy', signatures: false });
    expect(dup).toMatchObject({ status: 201, body: { systems: 1, signatures: 0, accessRules: 1 } });
    const copyId = (dup.body as ImportMapResultDto).map.id;
    const rules = (await s.call('GET', `/api/maps/${copyId}/access-rules`, 'alice')).body as AccessRuleDto[];
    expect(rules.map((r) => [r.subjectId, r.role])).toEqual([['bob', 'member']]);

    const settings = (await s.call('GET', `${base}/settings/export`, 'alice'))
      .body as MapSettingsExportDocument;
    expect(settings).toMatchObject({
      format: 'darkbeacon.map-settings',
      settings: { scopes: ['wormhole', 'low'] },
    });
    const other = (await s.call('POST', '/api/maps', 'alice', { name: 'Other' })).body as MapDto;
    const applied = await s.call('POST', `/api/maps/${other.id}/settings/import`, 'alice', {
      document: settings,
    });
    expect(applied).toMatchObject({
      status: 200,
      body: {
        settings: { scopes: ['wormhole', 'low'], offlineForManagersOnly: true },
        labels: [{ id: 'l1' }],
      },
    });
  });
});
