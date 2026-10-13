import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import { ImportRunner, SyncScheduler, type ImportingDeps } from '@darkbeacon/importing';
import type {
  CommentDto,
  ImportJobDto,
  ImportSyncDto,
  MapSnapshot,
  MeDto,
  StreamSnapshotDto,
  StructureDto,
  WandererDbMapsDto,
} from '@darkbeacon/shared';
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { FakeNetwork } from '../../adapters/identity/fake-network.js';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { Browser } from '../../test-support/browser.js';
import { createWandererDatabase } from '../../test-support/wanderer-db.js';
import { IMPORTING_DEPS } from './importing.module.js';

const url = process.env.TEST_DATABASE_URL;

describeEachDialect("imports from Wanderer's database", (t) => {
  let app: NestFastifyApplication;
  let base: string;
  let owner: Browser;
  const wanderer = { connectionString: '' };

  beforeAll(async () => {
    if (url) wanderer.connectionString = await createWandererDatabase(url);
  });

  beforeEach(async () => {
    const config = { ...parseEnv({ NODE_ENV: 'test', DEMO_MODE: 'true' }), secretKey: 'i'.repeat(32) };
    app = await createApp(config, { database: t.db, logger: false, fetch: new FakeNetwork().fetch });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    owner = new Browser(base);
    await owner.json<MeDto>('/api/auth/dev', { method: 'POST', json: { name: 'owner' } });
  });
  afterEach(() => app.close());

  const snapshot = async (mapId: string) =>
    (await owner.json<StreamSnapshotDto>(`/api/streams/${encodeURIComponent(`map:${mapId}`)}/snapshot`))
      .data as Required<MapSnapshot>;

  it.skipIf(!url)(
    'lists the maps, reads one with its hidden systems and imports it 1:1 (instance admins)',
    async () => {
      const stranger = new Browser(base);
      await stranger.json('/api/auth/dev', { method: 'POST', json: { name: 'stranger' } });
      const refused = await stranger.request('/api/imports/wanderer-db/maps', {
        method: 'POST',
        json: { connectionString: wanderer.connectionString },
      });
      expect(refused.status).toBe(403);

      const listed = await owner.json<WandererDbMapsDto>('/api/imports/wanderer-db/maps', {
        method: 'POST',
        json: { connectionString: wanderer.connectionString },
      });
      expect(listed.maps.map((m) => [m.slug, m.systems, m.hiddenSystems])).toEqual([
        ['shck', 6, 3],
        ['zanreal', 3, 1],
      ]);
      expect(JSON.stringify(listed)).not.toContain('password');

      const preview = await owner.json<ImportJobDto>('/api/imports/wanderer-db', {
        method: 'POST',
        json: {
          connectionString: wanderer.connectionString,
          slug: 'shck',
          wandererUrl: 'https://wanderer.example.org',
        },
      });
      expect(preview.source).toEqual({
        kind: 'wanderer-db',
        host: 'wanderer.example.org',
        slug: 'shck',
        name: 'SHCK-WH',
      });
      expect(preview.counts).toMatchObject({
        systems: 6,
        hiddenSystems: 3,
        signatures: 5,
        structures: 3,
        comments: 2,
        passages: 2,
        accessRules: 4,
        hubs: 3,
      });
      expect(JSON.stringify(preview)).not.toContain(wanderer.connectionString);

      await owner.json(`/api/imports/${preview.id}/start`, {
        method: 'POST',
        json: { mode: 'new', keepSyncing: { intervalMinutes: 15 } },
      });
      await app.get(ImportRunner).drain();
      const job = await owner.json<ImportJobDto>(`/api/imports/${preview.id}`);
      expect(job).toMatchObject({ status: 'done', error: null });
      expect(job.outcome.structures).toMatchObject({ created: 3 });
      expect(job.outcome.comments).toMatchObject({ created: 2 });
      const mapId = job.mapId!;
      const map = await snapshot(mapId);
      // The map's own label names, in Wanderer's order.
      expect(map.map.systemLabels.map((l) => l.name)).toEqual([
        'WH-ST',
        'WH1',
        'WH2',
        'WH3',
        'WH4',
        'WH5',
        'WH6',
        'WH-HS',
      ]);
      const home = map.systems.find((s) => s.solarSystemId === 31002531)!;
      expect(home).toMatchObject({
        status: 'home',
        customName: 'Home sweet home',
        customLabel: 'HOME',
        systemLabelIds: ['b'],
      });
      expect(map.systems.find((s) => s.solarSystemId === 31000399)).toMatchObject({ status: 'warning' });
      expect(map.map.labels.some((l) => l.name === 'Secondary')).toBe(false);
      // The hidden system keeps its intel for when it shows up again.
      const deps = app.get<ImportingDeps>(IMPORTING_DEPS);
      const all = await deps.target.systems((await deps.jobs.find(preview.id))!.actor, mapId);
      const deadEnd = all.find((s) => s.solarSystemId === 31002385)!;
      expect(deadEnd).toMatchObject({
        visible: false,
        customName: 'Dead end',
        description: 'Old static, Sansha fleet lives here',
        status: 'hostile',
        customLabel: 'OLD',
      });
      // Passages one by one, with pilot and ship.
      const pair = map.connections.find(
        (c) => [c.source, c.target].sort().join('-') === [31000399, 31002531].sort().join('-'),
      )!;
      expect(pair).toMatchObject({ locked: true, dangerous: true, bubbled: 'target', note: 'Rolled once' });
      const passages = await owner.json<Array<{ shipTypeId: number | null }>>(
        `/api/maps/${mapId}/connections/${pair.id}/passages`,
      );
      expect(passages.map((p) => p.shipTypeId).sort()).toEqual([29984, 605].sort());
      const comments = await owner.json<CommentDto[]>(`/api/maps/${mapId}/systems/31002531/comments`);
      expect(comments.map((c) => [c.text, c.author?.name])).toEqual([
        ['Rolled the static at 18:00', 'CCP Bartender'],
      ]);
      const structures = await owner.json<StructureDto[]>(`/api/maps/${mapId}/systems/31002531/structures`);
      expect(structures.map((s) => s.name)).toEqual(['Home Fort']);

      // It keeps syncing from the database.
      const sync = await owner.json<ImportSyncDto>(`/api/maps/${mapId}/import-sync`);
      expect(sync).toMatchObject({ enabled: true, source: { kind: 'wanderer-db', slug: 'shck' } });
      const record = (await deps.syncs.find(sync.id))!;
      await deps.syncs.update({ ...record, nextRunAt: 0 });
      expect(await app.get(SyncScheduler).tick()).toBe(1);
      await app.get(ImportRunner).drain();
      const pulled = await owner.json<ImportSyncDto>(`/api/maps/${mapId}/import-sync`);
      expect(pulled.lastError).toBeNull();
      const again = await owner.json<ImportJobDto>(`/api/imports/${pulled.lastJobId}`).catch(() => null);
      if (again) expect(again.outcome.structures).toMatchObject({ created: 0 });
    },
  );
});
