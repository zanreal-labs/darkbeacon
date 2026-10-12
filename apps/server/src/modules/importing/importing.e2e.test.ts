import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import { ImportRunner, SyncScheduler, type ImportingDeps } from '@darkbeacon/importing';
import {
  WANDERER_EXPORT_CONTENT_TYPE,
  type AccessRuleDto,
  type AuditPageDto,
  type ImportJobDto,
  type ImportPlanDto,
  type ImportSyncDto,
  type MapSnapshot,
  type MeDto,
  type StreamSnapshotDto,
  type WandererTestResultDto,
} from '@darkbeacon/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeNetwork } from '../../adapters/identity/fake-network.js';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { Browser } from '../../test-support/browser.js';
import { startFakeWanderer } from '../../test-support/fake-wanderer.js';
import { IMPORTING_DEPS } from './importing.module.js';

describeEachDialect('imports from Wanderer over HTTP', (t) => {
  let app: NestFastifyApplication;
  let base: string;
  let wanderer: Awaited<ReturnType<typeof startFakeWanderer>>;
  let owner: Browser;
  const network = new FakeNetwork();
  network.esiEntities.set(109299958, { name: 'C C P', category: 'corporation', ticker: 'CCP' });
  network.esiEntities.set(434243723, { name: 'C C P Alliance', category: 'alliance', ticker: 'CONCORD' });
  network.esiEntities.set(2112625428, { name: 'CCP Bartender', category: 'character' });

  beforeEach(async () => {
    const config = { ...parseEnv({ NODE_ENV: 'test', DEMO_MODE: 'true' }), secretKey: 'i'.repeat(32) };
    app = await createApp(config, { database: t.db, logger: false, fetch: network.fetch });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    wanderer = await startFakeWanderer();
    owner = new Browser(base);
    await owner.json<MeDto>('/api/auth/dev', { method: 'POST', json: { name: 'owner' } });
  });

  afterEach(async () => {
    await wanderer.close();
    await app.close();
  });

  const source = () => ({ baseUrl: wanderer.url, slug: 'home-chain', apiKey: wanderer.map.apiKey });
  const allowPrivate = () =>
    owner.json('/api/admin/settings', { method: 'PATCH', json: { importsFromPrivateNetworks: true } });
  const drain = () => app.get(ImportRunner).drain();
  const snapshot = async (browser: Browser, mapId: string) =>
    (await browser.json<StreamSnapshotDto>(`/api/streams/${encodeURIComponent(`map:${mapId}`)}/snapshot`))
      .data as Required<MapSnapshot>;

  /** Preview, start into a new map, run; returns the finished job. */
  const importNew = async (browser: Browser, extra: Record<string, unknown> = {}) => {
    const preview = await browser.json<ImportJobDto>('/api/imports/wanderer', {
      method: 'POST',
      json: source(),
    });
    await browser.json(`/api/imports/${preview.id}/start`, {
      method: 'POST',
      json: { mode: 'new', ...extra },
    });
    await drain();
    return browser.json<ImportJobDto>(`/api/imports/${preview.id}`);
  };

  it('refuses a Wanderer on a private network until an instance admin allows it', async () => {
    const response = await owner.request('/api/imports/wanderer/test', { method: 'POST', json: source() });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { message: string } }).error.message).toMatch(/https:\/\//);
    await allowPrivate();
    expect(
      await owner.json<WandererTestResultDto>('/api/imports/wanderer/test', {
        method: 'POST',
        json: source(),
      }),
    ).toMatchObject({ ok: true, systems: 30, message: null });
    expect(
      await owner.json<WandererTestResultDto>('/api/imports/wanderer/test', {
        method: 'POST',
        json: { ...source(), apiKey: 'wrong' },
      }),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/refused the API key/) });
  });

  it('previews, imports a whole map into a new one, audited and evented', async () => {
    await allowPrivate();
    const preview = await owner.json<ImportJobDto>('/api/imports/wanderer', {
      method: 'POST',
      json: source(),
    });
    expect(preview).toMatchObject({
      status: 'preview',
      mapId: null,
      source: { kind: 'wanderer-api', slug: 'home-chain', name: 'Home Chain' },
    });
    expect(preview.counts).toMatchObject({ systems: 28, hiddenSystems: 2, structures: 4, comments: 3 });
    expect(preview.report.some((l) => l.bucket === 'dropped' && /Cosmic anomaly/.test(l.what))).toBe(true);
    // ACL members with the names ESI gives now; the Officers ACL needs its own key.
    const ccp = preview.access.find((a) => a.subjectId === '109299958')!;
    expect(ccp).toMatchObject({
      subjectKind: 'corporation',
      esiName: 'C C P',
      ticker: 'CCP',
      role: 'member',
    });
    expect(preview.access.find((a) => a.subjectId === '2116161002')).toMatchObject({
      role: 'blocked',
      esiName: null,
    });
    expect(preview.report.some((l) => /Members of the ACL “Officers”/.test(l.what))).toBe(true);
    // Nobody else sees someone's import.
    const other = new Browser(base);
    await other.json('/api/auth/dev', { method: 'POST', json: { name: 'stranger' } });
    expect((await other.request(`/api/imports/${preview.id}`)).status).toBe(404);

    const plan = await owner.json<ImportPlanDto>(`/api/imports/${preview.id}/plan`, {
      method: 'POST',
      json: { mode: 'new' },
    });
    expect(plan.outcome.systems).toMatchObject({ created: 30 });

    const started = await owner.json<ImportJobDto>(`/api/imports/${preview.id}/start`, {
      method: 'POST',
      json: { mode: 'new', name: 'Imported chain' },
    });
    expect(started.status).toBe('queued');
    await drain();
    const job = await owner.json<ImportJobDto>(`/api/imports/${preview.id}`);
    expect(job).toMatchObject({ status: 'done', phase: 'done', mapName: 'Imported chain', error: null });
    expect(job.done).toBe(job.total);
    expect(job.outcome.systems).toMatchObject({ created: 30, skipped: 0 });
    expect(job.outcome.connections!.created).toBe(preview.counts.connections);
    expect(job.outcome.signatures!.created).toBe(preview.counts.signatures);
    expect(job.outcome.access!.created).toBe(preview.counts.accessRules);

    const mapId = job.mapId!;
    const map = await snapshot(owner, mapId);
    expect(map.systems).toHaveLength(28);
    expect(map.connections).toHaveLength(preview.counts.connections);
    const home = map.systems.find((s) => s.solarSystemId === 31002531)!;
    expect(home).toMatchObject({ customName: 'Home sweet home', tag: 'HQ', status: 'home', locked: true });
    expect(home.description).toContain('Fortizar “Home Fort” · Wormhole Rescue Ltd [RESQ]');
    expect(home.description).toContain('Neut Loki on d-scan');
    expect(map.map.labels.map((l) => l.name).sort()).toEqual([
      'Label 1',
      'Label A',
      'Label B',
      'Looking for',
      'Rolled',
      'Staging',
    ]);
    expect(map.map.settings.scopes).toEqual(['wormhole']);
    const eol = map.connections.find((c) => c.timeStatus === 'eol')!;
    expect(eol.eolAt).toBeLessThan(Date.now());
    expect(map.connections.some((c) => c.type === 'gate')).toBe(true);
    expect(map.connections.some((c) => c.type === 'bridge')).toBe(true);
    expect(map.connections.some((c) => c.dangerous && c.bubbled === 'target')).toBe(true);
    // Connections keep the time Wanderer first saw them (lifetimes count from then).
    const first = wanderer.map.connections[0]!;
    const kept = map.connections.find(
      (c) => c.source === first.solar_system_source && c.target === first.solar_system_target,
    )!;
    expect(kept.createdAt).toBe(Date.parse(String(first.inserted_at)));
    expect(map.signatures.filter((s) => s.connectionId).length).toBeGreaterThan(10);

    const rules = await owner.json<AccessRuleDto[]>(`/api/maps/${mapId}/access-rules`);
    expect(rules.map((r) => `${r.subjectKind}:${r.subjectId}:${r.role}`).sort()).toEqual([
      'alliance:434243723:member',
      'character:2112625428:admin',
      'character:2116161001:manager',
      'character:2116161002:blocked',
      'corporation:109299958:member',
      'corporation:98000001:blocked',
    ]);

    // Every change says where it came from.
    const history = await owner.json<AuditPageDto>(
      `/api/maps/${mapId}/history?types=system.*,import.*&limit=200`,
    );
    const channels = new Set(
      history.entries.filter((e) => e.type.startsWith('system.')).map((e) => e.channel.id),
    );
    expect([...channels]).toEqual([`wanderer:${wanderer.url.replace('http://', '')}/home-chain`]);
    expect(history.entries.map((e) => e.type)).toEqual(
      expect.arrayContaining(['import.started', 'import.finished']),
    );
    const finished = history.entries.find((e) => e.type === 'import.finished')!;
    expect(finished.diff.imported?.after).toBe(`Wanderer ${wanderer.url.replace('http://', '')}/home-chain`);

    // The report download carries the Wanderer fields that have no place here.
    const report = await owner.request(`/api/imports/${preview.id}/report`);
    expect(report.headers.get('content-disposition')).toMatch(
      /attachment; filename="darkbeacon-import-home-chain-/,
    );
    const body = (await report.json()) as {
      importedExtra: Array<{ kind: string; extra: Record<string, unknown> }>;
    };
    expect(
      body.importedExtra.some(
        (x) => x.kind === 'connection' && x.extra.customInfo === 'Rolled once, second roll pending',
      ),
    ).toBe(true);
  });

  it('runs again without duplicates, merging field by field and never deleting unless asked', async () => {
    await allowPrivate();
    const first = await importNew(owner);
    const mapId = first.mapId!;
    const before = await snapshot(owner, mapId);
    const home = before.systems.find((s) => s.solarSystemId === 31002531)!;

    // Here: a new tag on the home system. In Wanderer: new notes on another system, one hole gone.
    await owner.json(`/api/maps/${mapId}/systems/31002531`, { method: 'PATCH', json: { tag: 'HOME' } });
    const c5 = wanderer.map.systems.find((s) => s.solar_system_id === 31001924)!;
    c5.description = 'Moved out, empty now';
    c5.updated_at = new Date().toISOString();
    const gone = wanderer.map.connections.pop()!;

    const again = await owner.json<ImportJobDto>('/api/imports/wanderer', { method: 'POST', json: source() });
    const plan = await owner.json<ImportPlanDto>(`/api/imports/${again.id}/plan`, {
      method: 'POST',
      json: { mode: 'merge', mapId },
    });
    expect(plan.outcome.systems).toMatchObject({ created: 0, updated: 1 });
    expect(plan.outcome.connections).toMatchObject({ created: 0, updated: 0 });
    expect(plan.outcome.signatures).toMatchObject({ created: 0, updated: 0 });

    await owner.json(`/api/imports/${again.id}/start`, { method: 'POST', json: { mode: 'merge', mapId } });
    await drain();
    const merged = await owner.json<ImportJobDto>(`/api/imports/${again.id}`);
    expect(merged.status).toBe('done');
    expect(merged.outcome.systems).toMatchObject({ created: 0, updated: 1, removed: 0 });
    expect(merged.outcome.access).toMatchObject({ created: 0, unchanged: 6 });
    const after = await snapshot(owner, mapId);
    expect(after.systems).toHaveLength(before.systems.length);
    expect(after.signatures).toHaveLength(before.signatures.length);
    expect(after.systems.find((s) => s.solarSystemId === 31002531)!.tag).toBe('HOME');
    expect(after.systems.find((s) => s.solarSystemId === 31001924)!.description).toContain(
      'Moved out, empty now',
    );
    // The hole Wanderer lost is still here: removals were not asked for.
    expect(after.connections).toHaveLength(before.connections.length);
    expect((await owner.json<AccessRuleDto[]>(`/api/maps/${mapId}/access-rules`)).length).toBe(6);
    expect(home.position).toEqual(after.systems.find((s) => s.solarSystemId === 31002531)!.position);

    // Asked to remove what Wanderer removed: only that hole goes.
    const third = await owner.json<ImportJobDto>('/api/imports/wanderer', { method: 'POST', json: source() });
    await owner.json(`/api/imports/${third.id}/start`, {
      method: 'POST',
      json: { mode: 'merge', mapId, removeMissing: true },
    });
    await drain();
    expect((await owner.json<ImportJobDto>(`/api/imports/${third.id}`)).outcome.connections).toMatchObject({
      removed: 1,
    });
    const pruned = await snapshot(owner, mapId);
    expect(pruned.connections).toHaveLength(before.connections.length - 1);
    expect(
      pruned.connections.some(
        (c) => c.source === gone.solar_system_source && c.target === gone.solar_system_target,
      ),
    ).toBe(false);
  });

  it('merges only for map managers and imports access rules only for map admins', async () => {
    await allowPrivate();
    const first = await importNew(owner);
    const mapId = first.mapId!;
    const member = new Browser(base);
    const me = await member.json<MeDto>('/api/auth/dev', { method: 'POST', json: { name: 'member' } });
    await owner.json(`/api/maps/${mapId}/access-rules`, {
      method: 'POST',
      json: { subjectKind: 'account', subjectId: me.account.id, role: 'member' },
    });
    const preview = await member.json<ImportJobDto>('/api/imports/wanderer', {
      method: 'POST',
      json: source(),
    });
    const refused = await member.request(`/api/imports/${preview.id}/start`, {
      method: 'POST',
      json: { mode: 'merge', mapId },
    });
    expect(refused.status).toBe(403);
  });

  it('imports an uploaded export file, streamed and checked', async () => {
    const upload = (body: string) =>
      fetch(`http://${base}/api/imports/wanderer/file?name=chain.json`, {
        method: 'POST',
        headers: { cookie: owner.cookieHeader, 'content-type': WANDERER_EXPORT_CONTENT_TYPE },
        body,
      });
    const bad = await upload('{not json');
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { message: string } }).error.message).toMatch(/not JSON/);
    const wrong = await upload(JSON.stringify({ hello: 'world' }));
    expect(((await wrong.json()) as { error: { message: string } }).error.message).toMatch(
      /not a Wanderer export/,
    );

    const file = {
      version: 2,
      exported_at: new Date().toISOString(),
      map: { name: 'From a file', slug: 'file-chain' },
      systems: wanderer.map.systems
        .slice(0, 5)
        .map((s) => ({ ...s, position: { x: s.position_x, y: s.position_y } })),
      connections: [],
      signatures: wanderer.map.signatures.filter((s) => s.solar_system_id === 31002531),
      comments: [],
      structures: [],
    };
    const response = await upload(JSON.stringify(file));
    expect(response.status).toBe(201);
    const preview = (await response.json()) as ImportJobDto;
    expect(preview.source).toEqual({
      kind: 'wanderer-file',
      host: 'file',
      slug: 'file-chain',
      name: 'From a file',
    });
    const sync = await owner.request(`/api/imports/${preview.id}/start`, {
      method: 'POST',
      json: { mode: 'new', keepSyncing: { intervalMinutes: 15 } },
    });
    expect(sync.status).toBe(400);
    await owner.json(`/api/imports/${preview.id}/start`, { method: 'POST', json: { mode: 'new' } });
    await drain();
    const job = await owner.json<ImportJobDto>(`/api/imports/${preview.id}`);
    expect(job).toMatchObject({ status: 'done', mapName: 'From a file' });
    expect((await snapshot(owner, job.mapId!)).systems.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps syncing every few minutes until stopped', async () => {
    await allowPrivate();
    const job = await importNew(owner, { keepSyncing: { intervalMinutes: 5 } });
    const mapId = job.mapId!;
    const sync = await owner.json<ImportSyncDto>(`/api/maps/${mapId}/import-sync`);
    expect(sync).toMatchObject({ enabled: true, intervalMinutes: 5, mapId, source: { slug: 'home-chain' } });
    expect(job.syncId).toBe(sync.id);

    // Not due yet: nothing happens.
    expect(await app.get(SyncScheduler).tick()).toBe(0);
    // Due: Wanderer has a new system note, the pull merges it.
    const deps = app.get<ImportingDeps>(IMPORTING_DEPS);
    const record = (await deps.syncs.find(sync.id))!;
    await deps.syncs.update({ ...record, nextRunAt: 0 });
    const home = wanderer.map.systems.find((s) => s.solar_system_id === 31002531)!;
    home.temporary_name = 'base';
    home.updated_at = new Date().toISOString();
    expect(await app.get(SyncScheduler).tick()).toBe(1);
    await drain();
    const pulled = (await owner.json<ImportSyncDto>(`/api/maps/${mapId}/import-sync`))!;
    expect(pulled.lastJobId).not.toBe(job.id);
    expect(pulled.lastError).toBeNull();
    expect(
      (await snapshot(owner, mapId)).systems.find((s) => s.solarSystemId === 31002531)!.temporaryName,
    ).toBe('base');

    await owner.request(`/api/maps/${mapId}/import-sync`, { method: 'DELETE' });
    const stopped = await owner.request(`/api/maps/${mapId}/import-sync`);
    expect(['', 'null']).toContain(await stopped.text());
    const history = await owner.json<AuditPageDto>(`/api/maps/${mapId}/history?types=import.sync_changed`);
    expect(history.entries.map((e) => e.diff.syncing?.after)).toEqual([false, true]);
  });

  it('cancels a staged import, which cannot start then', async () => {
    await allowPrivate();
    const preview = await owner.json<ImportJobDto>('/api/imports/wanderer', {
      method: 'POST',
      json: source(),
    });
    const cancelled = await owner.json<ImportJobDto>(`/api/imports/${preview.id}/cancel`, { method: 'POST' });
    expect(cancelled.status).toBe('cancelled');
    const start = await owner.request(`/api/imports/${preview.id}/start`, {
      method: 'POST',
      json: { mode: 'new' },
    });
    expect(start.status).toBe(409);
    expect((await owner.json<ImportJobDto>(`/api/imports/${preview.id}`)).mapId).toBeNull();
  });
});
