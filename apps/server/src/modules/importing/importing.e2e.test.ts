import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import { ImportRunner, SyncScheduler, type ImportingDeps } from '@darkbeacon/importing';
import {
  WANDERER_EXPORT_CONTENT_TYPE,
  type AccessRuleDto,
  type AuditPageDto,
  type HubsDto,
  type ImportJobDto,
  type ImportPlanDto,
  type ImportSyncDto,
  type MapSnapshot,
  type MeDto,
  type StreamSnapshotDto,
  type WandererTestResultDto,
  type WebhookDto,
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
    // Anomalies, other scanner rows and custom entries come over too.
    expect(preview.report.some((l) => l.bucket === 'mapped' && /anomaly/.test(l.what))).toBe(true);
    expect(preview.report.filter((l) => l.bucket === 'dropped').map((l) => l.what)).toEqual(
      expect.not.arrayContaining([expect.stringMatching(/anomal|Lock|custom|note|Passage/i)]),
    );
    expect(preview.counts.passages).toBe(5);
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
    expect(home.description).toContain('Structure: Fortizar “Home Fort”\nOwner: Wormhole Rescue Ltd [RESQ]');
    expect(home.description).toContain('Neut Loki on d-scan');
    // Changes carry Wanderer's times (the field times maps merging this one compare).
    const wandererHome = wanderer.map.systems.find((x) => x.solar_system_id === 31002531)!;
    expect(home.updatedAt).toBe(Date.parse(String(wandererHome.updated_at)));
    expect(map.map.labels.map((l) => l.name).sort()).toEqual([
      'Label 1',
      'Label A',
      'Label B',
      'Looking for',
      'Rolled',
      'Secondary',
      'Staging',
    ]);
    expect(map.map.settings.scopes).toEqual(['wormhole']);
    // The map's description, shown in the list of maps.
    expect(map.map.description).toBe('Our main chain');
    const listed = await owner.json<Array<{ id: string; description?: string }>>('/api/maps');
    expect(listed.find((m) => m.id === mapId)?.description).toBe('Our main chain');
    // Hubs the map's users set in Wanderer, most used first (another map's user settings ignored).
    const hubs = await owner.json<HubsDto>(`/api/maps/${mapId}/hubs`);
    expect(hubs.map.map((h) => h.solarSystemId)).toEqual([30000142, 30002187, 30002659]);
    // Webhook subscriptions come over switched off, with Darkbeacon's events; kills have no match.
    const hooks = await owner.json<WebhookDto[]>(`/api/maps/${mapId}/webhooks`);
    expect(hooks.map((h) => [h.url, h.enabled]).sort()).toEqual([
      ['https://bots.example.org/darkbeacon', false],
      ['https://hooks.example.com/wanderer/chain?token=abc', false],
    ]);
    expect(hooks.find((h) => h.url.includes('/chain'))!.events.sort()).toEqual([
      'connection.added',
      'connection.removed',
      'connection.updated',
      'signature.added',
      'signature.removed',
      'signature.updated',
      'system.added',
      'system.removed',
    ]);
    expect(hooks.find((h) => h.url.includes('bots.'))!.events).toContain('system.*');
    // An admin gets a new signing secret (nobody saw the first one) and switches it on.
    const bot = hooks.find((h) => h.url.includes('bots.'))!;
    const rotated = await owner.json<WebhookDto & { secret: string }>(
      `/api/maps/${mapId}/webhooks/${bot.id}/rotate-secret`,
      { method: 'POST' },
    );
    expect(rotated.secret.length).toBeGreaterThan(20);
    const on = await owner.json<WebhookDto>(`/api/maps/${mapId}/webhooks/${bot.id}`, {
      method: 'PATCH',
      json: { enabled: true },
    });
    expect(on.enabled).toBe(true);
    expect(job.warnings.some((w) => /webhooks were added switched off/.test(w))).toBe(true);
    expect(preview.counts.webhooks).toBe(2);
    expect(
      preview.report.some(
        (l) => l.bucket === 'dropped' && /map_kill/.test(l.what) && /zKillboard/.test(l.why ?? ''),
      ),
    ).toBe(true);
    // Wanderer's signing secrets are never read; the report shows hosts, never paths or tokens.
    expect(JSON.stringify(preview)).not.toContain('wanderer-secret-never-read');
    expect(JSON.stringify(preview.report)).not.toContain('token=abc');
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
    // 1:1 intel: anomalies, other scanner rows, custom entries; notes, locks, lifetimes; passages.
    const wSig = wanderer.map.signatures;
    const kindOf = (eveId: string) => map.signatures.find((x) => x.eveId === eveId);
    for (const w of wSig.filter((x) => x.kind === 'Cosmic Anomaly'))
      expect(kindOf(String(w.eve_id).toUpperCase())?.kind).toBe('anomaly');
    expect(kindOf('TOWER-1')).toMatchObject({ custom: true, name: 'Our Raitaru, moon 3' });
    expect(kindOf('AB-12')).toMatchObject({ custom: true, group: 'data' });
    expect(map.signatures.find((x) => x.kind === 'other')).toMatchObject({
      type: 'Structure',
      name: 'Astrahus',
    });
    const pairOf = (w: { solar_system_source: number; solar_system_target: number }) =>
      map.connections.find(
        (c) =>
          (c.source === w.solar_system_source && c.target === w.solar_system_target) ||
          (c.source === w.solar_system_target && c.target === w.solar_system_source),
      );
    for (const w of wanderer.map.connections) {
      const here = pairOf(w);
      if (!here) continue;
      expect(here.locked ?? false, 'locked').toBe(w.locked === true);
      if (typeof w.custom_info === 'string') expect(here.note).toContain(w.custom_info);
      const marks = ['', '1h', '4h', '4.5h', '16h', '24h', '48h'];
      if (Number(w.time_status) > 0) expect(here.lifetime?.mark).toBe(marks[Number(w.time_status)]);
    }
    const passages = await owner.json<Array<{ characterId: number; shipTypeId: number | null }>>(
      `/api/maps/${mapId}/connections/${pairOf(wanderer.map.connections[0]!)!.id}/passages`,
    );
    expect(passages.map((p) => p.shipTypeId).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([605, 22456]);
    expect(home.description).toContain('Comment by Scout Alt');
    // Imported wormholes are numbered like any other ({n} of the bookmark labels).
    expect(map.connections.filter((c) => c.type === 'wormhole' && c.bookmarkNumber).length).toBeGreaterThan(
      10,
    );

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
    expect(body.importedExtra.some((x) => x.kind === 'connection' && x.extra.countOfPassage === 7)).toBe(
      true,
    );
  });

  it('runs again without duplicates, merging field by field and never deleting unless asked', async () => {
    await allowPrivate();
    const first = await importNew(owner);
    const mapId = first.mapId!;
    const before = await snapshot(owner, mapId);
    const home = before.systems.find((s) => s.solarSystemId === 31002531)!;

    // Here: a new tag on the home system. In Wanderer: new notes on another system, one hole gone.
    await owner.json(`/api/maps/${mapId}/systems/31002531`, { method: 'PATCH', json: { tag: 'HOME' } });
    // Here too: our own description, and one imported webhook deleted.
    await owner.json(`/api/maps/${mapId}`, { method: 'PATCH', json: { description: 'Ours now' } });
    const hooks = await owner.json<WebhookDto[]>(`/api/maps/${mapId}/webhooks`);
    await owner.request(`/api/maps/${mapId}/webhooks/${hooks[0]!.id}`, { method: 'DELETE' });
    wanderer.map.map.description = 'Wanderer changed it';
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
    // Our description stays; the deleted webhook is not added again, the other not doubled.
    expect(after.map.description).toBe('Ours now');
    expect(await owner.json<WebhookDto[]>(`/api/maps/${mapId}/webhooks`)).toHaveLength(1);

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

    // A map that merges other maps holds nothing of its own to import into.
    const composite = await owner.json<{ id: string }>('/api/maps', {
      method: 'POST',
      json: { name: 'All chains', kind: 'composite' },
    });
    const mine = await owner.json<ImportJobDto>('/api/imports/wanderer', { method: 'POST', json: source() });
    const merge = await owner.request(`/api/imports/${mine.id}/plan`, {
      method: 'POST',
      json: { mode: 'merge', mapId: composite.id },
    });
    expect(merge.status).toBe(409);
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
