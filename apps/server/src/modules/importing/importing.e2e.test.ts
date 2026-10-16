import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import { ImportRunner, SyncScheduler, type ImportingDeps } from '@darkbeacon/importing';
import {
  WANDERER_EXPORT_CONTENT_TYPE,
  type AccessRuleDto,
  DEFAULT_TAGS,
  type AuditPageDto,
  type CommentDto,
  type HubsDto,
  type ImportJobDto,
  type ImportPlanDto,
  type ImportSyncDto,
  type MapSnapshot,
  type MeDto,
  type StreamSnapshotDto,
  type StructureDto,
  type WandererTestResultDto,
  type WebhookDto,
} from '@darkbeacon/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeNetwork } from '../../adapters/identity/fake-network.js';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { Browser } from '../../test-support/browser.js';
import { startFakeWanderer } from '../../test-support/fake-wanderer.js';
import { SweeperRuntime } from '../mapping/sweeper.runtime.js';
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
    ).toMatchObject({ ok: true, systems: 28, hiddenSystems: 2, message: null });
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
    // Hidden systems come over too, with their intel (the hidden one's structure and comment).
    expect(preview.counts).toMatchObject({ systems: 28, hiddenSystems: 2, structures: 5, comments: 4 });
    // Anomalies, other scanner rows and custom entries come over too.
    expect(preview.report.some((l) => l.bucket === 'mapped' && /anomaly/.test(l.what))).toBe(true);
    expect(preview.report.filter((l) => l.bucket === 'dropped').map((l) => l.what)).toEqual(
      expect.not.arrayContaining([expect.stringMatching(/anomal|Lock|custom|note/i)]),
    );
    // Wanderer's API counts passages per connection only (its database lists them one by one).
    expect(preview.counts.passages).toBe(0);
    // ACL members with the names ESI gives now, every ACL read with the map key over JSON:API.
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
    expect(preview.access.find((a) => a.subjectId === '2116161003')).toMatchObject({ role: 'admin' });
    expect(preview.report.some((l) => /Members of the ACL/.test(l.what))).toBe(false);
    // Nobody else sees someone's import.
    const other = new Browser(base);
    await other.json('/api/auth/dev', { method: 'POST', json: { name: 'stranger' } });
    expect((await other.request(`/api/imports/${preview.id}`)).status).toBe(404);

    const plan = await owner.json<ImportPlanDto>(`/api/imports/${preview.id}/plan`, {
      method: 'POST',
      json: { mode: 'new' },
    });
    expect(plan.outcome.systems).toMatchObject({ created: 30 });
    // The new map's default Farm Tag takes Wanderer's FARM; HQ, OLD and Looking for are new Tags, and
    // the four Labels are new.
    expect(plan.outcome.labels).toMatchObject({ created: 7, unchanged: 1 });

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
    expect(job.outcome.labels).toMatchObject({ created: 7, unchanged: 1 });
    expect(job.outcome.connections!.created).toBe(preview.counts.connections);
    expect(job.outcome.signatures!.created).toBe(preview.counts.signatures);
    expect(job.outcome.access!.created).toBe(preview.counts.accessRules);

    const mapId = job.mapId!;
    const map = await snapshot(owner, mapId);
    expect(map.systems).toHaveLength(28);
    expect(map.connections).toHaveLength(preview.counts.connections);
    const home = map.systems.find((s) => s.solarSystemId === 31002531)!;
    expect(home).toMatchObject({ customName: 'Home sweet home', status: 'home', locked: true });
    // Structures and comments are Darkbeacon structures and comments, with their authors and times.
    expect(home.description).not.toContain('Home Fort');
    const structures = await owner.json<StructureDto[]>(`/api/maps/${mapId}/systems/31002531/structures`);
    expect(structures.find((s) => s.name === 'Home Fort')).toMatchObject({
      typeName: 'Fortizar',
      owner: { name: 'Wormhole Rescue Ltd', ticker: 'RESQ' },
      createdBy: { name: 'CCP Bartender' },
    });
    const comments = await owner.json<CommentDto[]>(`/api/maps/${mapId}/systems/31002531/comments`);
    expect(comments.find((c) => c.text.startsWith('Neut Loki on d-scan'))?.author?.name).toBe('Scout Alt');
    expect(job.outcome.structures!.created).toBe(preview.counts.structures);
    expect(job.outcome.comments!.created).toBe(preview.counts.comments);
    // Changes carry Wanderer's times (the field times maps merging this one compare).
    const wandererHome = wanderer.map.systems.find((x) => x.solar_system_id === 31002531)!;
    expect(home.updatedAt).toBe(Date.parse(String(wandererHome.updated_at)));
    // Wanderer's label list becomes the map's Labels (ids kept, colours dropped).
    expect(map.map.systemLabels).toEqual([
      { id: 'a', name: 'A', description: '' },
      { id: 'b', name: 'B', description: '' },
      { id: '1', name: '1', description: 'First wave' },
      { id: 'x1', name: 'Exit', description: 'Our way out to k-space' },
    ]);
    // A system's labels are its Labels, its custom label stays one; Darkbeacon's `tag` is untouched.
    expect(home).toMatchObject({ systemLabelIds: ['a', '1'], customLabel: 'Staging', tag: null });
    expect(map.systems.find((s) => s.solarSystemId === 31000505)).toMatchObject({
      systemLabelIds: ['x1'],
      customLabel: 'Rolled',
    });
    expect(map.systems.find((s) => s.solarSystemId === 31001924)!.systemLabelIds).toEqual(['b']);
    expect(map.systems.every((s) => s.tag === null)).toBe(true);
    // Wanderer's tag becomes a Tag of that name; statuses without a match here become Tags too. A
    // name the map's default Tags have already (FARM, any case) reuses that Tag, never a second one.
    const tagNames = (ids: string[]) => ids.map((id) => map.map.labels.find((l) => l.id === id)!.name);
    expect(tagNames(home.labelIds)).toEqual(['HQ']);
    expect(tagNames(map.systems.find((s) => s.solarSystemId === 31001924)!.labelIds)).toContain('Farm');
    expect(map.map.labels.slice(0, DEFAULT_TAGS.length)).toEqual(DEFAULT_TAGS);
    expect(
      map.map.labels
        .slice(DEFAULT_TAGS.length)
        .map((l) => l.name)
        .sort(),
    ).toEqual(['HQ', 'Looking for', 'OLD']);
    expect(map.map.settings.scopes).toEqual(['wormhole']);
    // The map's description, shown in the list of maps.
    expect(map.map.description).toBe('Our main chain');
    const listed = await owner.json<Array<{ id: string; description?: string }>>('/api/maps');
    expect(listed.find((m) => m.id === mapId)?.description).toBe('Our main chain');
    // The trade hubs every map starts with; the hubs the map's users set in Wanderer (Jita, Amarr,
    // Dodixie: this Wanderer's API does not give the map's own) are among them, none twice.
    const hubs = await owner.json<HubsDto>(`/api/maps/${mapId}/hubs`);
    expect(hubs.map.map((h) => h.solarSystemId)).toEqual([30000142, 30002187, 30002659, 30002510, 30002053]);
    expect(job.warnings.some((w) => /does not give the map's own hubs/.test(w))).toBe(true);
    // Their own hubs wait for accounts with their characters.
    expect(job.warnings.some((w) => /2 of 2 Wanderer users have no Darkbeacon account/.test(w))).toBe(true);
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
    // Who wrote a comment comes from the character name Wanderer resolves.
    const thread = await owner.json<CommentDto[]>(`/api/maps/${mapId}/systems/31002531/comments`);
    expect(thread.some((c) => c.author?.name === 'Scout Alt')).toBe(true);
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
      'character:2116161003:admin',
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

    // Here: a new custom label on the home system. In Wanderer: new notes elsewhere, one hole gone.
    await owner.json(`/api/maps/${mapId}/systems/31002531`, {
      method: 'PATCH',
      json: { customLabel: 'home' },
    });
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
    expect(merged.outcome.access).toMatchObject({ created: 0, unchanged: 7 });
    // Comments and structures are not doubled either.
    expect(merged.outcome.comments).toMatchObject({ created: 0 });
    expect(merged.outcome.structures).toMatchObject({ created: 0 });
    const after = await snapshot(owner, mapId);
    expect(after.systems).toHaveLength(before.systems.length);
    expect(after.signatures).toHaveLength(before.signatures.length);
    expect(after.systems.find((s) => s.solarSystemId === 31002531)!.customLabel).toBe('home');
    // Labels and Tags are not doubled by a second import.
    expect(after.map.systemLabels).toHaveLength(4);
    expect(after.map.labels).toHaveLength(DEFAULT_TAGS.length + 3);
    expect(after.systems.find((s) => s.solarSystemId === 31001924)!.description).toContain(
      'Moved out, empty now',
    );
    // The hole Wanderer lost is still here: removals were not asked for.
    expect(after.connections).toHaveLength(before.connections.length);
    expect((await owner.json<AccessRuleDto[]>(`/api/maps/${mapId}/access-rules`)).length).toBe(7);
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
      signatures: wanderer.map.signatures
        .filter((s) => s.system_id === wanderer.map.systems.find((x) => x.solar_system_id === 31002531)!.id)
        .map((s) => ({ ...s, solar_system_id: 31002531 })),
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

  it("a sync's pull removes the signatures Wanderer deleted or replaced, not ones changed or deleted here", async () => {
    await allowPrivate();
    const job = await importNew(owner, { keepSyncing: { intervalMinutes: 5 } });
    const mapId = job.mapId!;
    const deps = app.get<ImportingDeps>(IMPORTING_DEPS);
    const syncId = (await owner.json<ImportSyncDto>(`/api/maps/${mapId}/import-sync`)).id;
    const sync = (await deps.syncs.find(syncId))!;
    expect(sync.removeMissing).toBe(false);
    const every = async () =>
      new Map((await deps.target.signatures(sync.actor, mapId)).map((s) => [s.eveId, s]));
    const before = await every();
    expect([...before.keys()]).toEqual(
      expect.arrayContaining(['PKM-342', 'EHX-232', 'NNV-694', 'HPW-234', 'CXF-894', 'DWR-193', 'HID-001']),
    );
    // Wanderer's soft-deleted row was never imported.
    expect(before.has('DEL-404')).toBe(false);

    const now = new Date().toISOString();
    const row = (eveId: string) => wanderer.map.signatures.find((g) => g.eve_id === eveId)!;
    // In Wanderer: a relic site deleted (JSON:API still lists it, `deleted: true`; the other routes
    // leave it out), a data site gone from every list, a gas site re-scanned under a new id, an
    // ore site re-pasted as what it really is, a hole of a hidden system deleted.
    row('PKM-342').deleted = true;
    row('PKM-342').updated_at = now;
    wanderer.map.signatures.splice(wanderer.map.signatures.indexOf(row('EHX-232')), 1);
    Object.assign(row('NNV-694'), { eve_id: 'QRS-111', id: 'c3b7c8f4-5d0e-4c4a-9d0a-111111111111' });
    Object.assign(row('QRS-111'), { inserted_at: now, updated_at: now });
    Object.assign(row('HPW-234'), {
      group: 'Gas Site',
      name: 'Bountiful Frontier Reservoir',
      updated_at: now,
    });
    row('HID-001').deleted = true;
    // Deleted in Wanderer too, but someone wrote on it here since the pull: it stays.
    row('CXF-894').deleted = true;
    await owner.json(`/api/maps/${mapId}/signatures/${before.get('CXF-894')!.id}`, {
      method: 'PATCH',
      json: { description: 'Sleepers asleep, run it later' },
    });
    // Removed here, unchanged in Wanderer: the pull does not bring it back.
    await owner.request(`/api/maps/${mapId}/signatures/${before.get('DWR-193')!.id}`, { method: 'DELETE' });

    const pullNow = async () => {
      await deps.syncs.update({ ...(await deps.syncs.find(syncId))!, nextRunAt: 0 });
      expect(await app.get(SyncScheduler).tick()).toBe(1);
      await drain();
      const pulled = (await owner.json<ImportSyncDto>(`/api/maps/${mapId}/import-sync`))!;
      return owner.json<ImportJobDto>(`/api/imports/${pulled.lastJobId}`);
    };
    const pull = await pullNow();
    expect(pull.status).toBe('done');
    expect(pull.outcome.signatures).toMatchObject({ created: 1, updated: 1, removed: 4 });
    // Only signatures: the rest still needs removals asked for.
    expect(pull.outcome.systems!.removed).toBe(0);
    expect(pull.outcome.connections!.removed).toBe(0);

    const after = await every();
    for (const gone of ['PKM-342', 'EHX-232', 'NNV-694', 'HID-001', 'DWR-193'])
      expect(after.has(gone)).toBe(false);
    expect(after.get('QRS-111')).toMatchObject({ group: 'gas' });
    expect(after.get('HPW-234')).toMatchObject({ group: 'gas', name: 'Bountiful Frontier Reservoir' });
    expect(after.get('CXF-894')!.description).toBe('Sleepers asleep, run it later');
    expect(after.size).toBe(before.size - 5 + 1);

    // Each removal is in the history, as the import, and leaves a tombstone.
    const history = await owner.json<AuditPageDto>(
      `/api/maps/${mapId}/history?types=signature.removed&limit=50`,
    );
    // The hidden system's goes quietly, as everything about it.
    expect(history.entries.filter((e) => e.channel.id?.startsWith('wanderer:'))).toHaveLength(3);
    const tombstones = await deps.target.signatureTombstones(sync.actor, mapId);
    expect([...tombstones.keys()]).toEqual(
      expect.arrayContaining([
        '31002531:PKM-342',
        '31002531:EHX-232',
        '31001924:NNV-694',
        '31002385:HID-001',
      ]),
    );

    // The next pull changes nothing.
    const again = await pullNow();
    expect(again.outcome.signatures).toMatchObject({ created: 0, updated: 0, removed: 0 });
    expect((await every()).size).toBe(after.size);
  }, 60_000);

  it('does not bring back what the lazy delete removed, unless Wanderer scanned it again', async () => {
    await allowPrivate();
    const row = (eveId: string) => wanderer.map.signatures.find((g) => g.eve_id === eveId)!;
    const dayAndAHalf = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    for (const eveId of ['PKM-342', 'EHX-232'])
      Object.assign(row(eveId), { inserted_at: dayAndAHalf, updated_at: dayAndAHalf });
    const job = await importNew(owner, { keepSyncing: { intervalMinutes: 5 } });
    const mapId = job.mapId!;
    const deps = app.get<ImportingDeps>(IMPORTING_DEPS);
    const syncId = (await owner.json<ImportSyncDto>(`/api/maps/${mapId}/import-sync`)).id;
    const actor = (await deps.syncs.find(syncId))!.actor;
    const codes = async () => new Set((await deps.target.signatures(actor, mapId)).map((s) => s.eveId));
    expect((await codes()).has('PKM-342')).toBe(true);

    // Added in Wanderer a day and a half ago: gone. (Wanderer's JSON:API gives no times, so the
    // hidden system's signatures count from the import.)
    await app.get(SweeperRuntime).runOnce();
    let left = await codes();
    for (const gone of ['PKM-342', 'EHX-232']) expect(left.has(gone)).toBe(false);
    expect(left.has('HID-001')).toBe(true);
    expect(left.has('NNV-694')).toBe(true);
    const history = await owner.json<AuditPageDto>(`/api/maps/${mapId}/history?types=signature.removed`);
    expect(history.entries.map((e) => e.channel)).toEqual([
      expect.objectContaining({ kind: 'system', id: 'sweeper' }),
      expect.objectContaining({ kind: 'system', id: 'sweeper' }),
    ]);

    // Wanderer scans one of them again; the other is just still listed there.
    Object.assign(row('EHX-232'), {
      name: 'Unsecured Frontier Database',
      updated_at: new Date().toISOString(),
    });
    await deps.syncs.update({ ...(await deps.syncs.find(syncId))!, nextRunAt: 0 });
    expect(await app.get(SyncScheduler).tick()).toBe(1);
    await drain();
    left = await codes();
    expect(left.has('EHX-232')).toBe(true);
    expect(left.has('PKM-342')).toBe(false);
  }, 60_000);

  /** A map imported from the fake Wanderer that keeps syncing, with ways to pull and look at it. */
  const syncing = async () => {
    const job = await importNew(owner, { keepSyncing: { intervalMinutes: 5 } });
    const mapId = job.mapId!;
    const deps = app.get<ImportingDeps>(IMPORTING_DEPS);
    const syncId = (await owner.json<ImportSyncDto>(`/api/maps/${mapId}/import-sync`)).id;
    const actor = (await deps.syncs.find(syncId))!.actor;
    return {
      mapId,
      deps,
      actor,
      signatures: async () => new Map((await deps.target.signatures(actor, mapId)).map((s) => [s.eveId, s])),
      tombstone: async (key: string) => (await deps.target.signatureTombstones(actor, mapId)).get(key),
      pull: async () => {
        await deps.syncs.update({ ...(await deps.syncs.find(syncId))!, nextRunAt: 0 });
        expect(await app.get(SyncScheduler).tick()).toBe(1);
        await drain();
        const pulled = (await owner.json<ImportSyncDto>(`/api/maps/${mapId}/import-sync`))!;
        const done = await owner.json<ImportJobDto>(`/api/imports/${pulled.lastJobId}`);
        expect(done.status).toBe('done');
        return done;
      },
    };
  };
  const HOUR = 60 * 60 * 1000;
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();
  const wandererRow = (eveId: string) => wanderer.map.signatures.find((g) => g.eve_id === eveId)!;
  const sweep = () => app.get(SweeperRuntime).runOnce();

  it("keeps a signature Wanderer pasted again alive: the same record, with Wanderer's times", async () => {
    await allowPrivate();
    const old = hoursAgo(30);
    for (const eveId of ['PKM-342', 'EHX-232', 'NNV-694'])
      Object.assign(wandererRow(eveId), { inserted_at: old, updated_at: old });
    const map = await syncing();
    const before = await map.signatures();
    expect(before.get('PKM-342')).toMatchObject({ createdAt: Date.parse(old), updatedAt: Date.parse(old) });

    // In Wanderer: the relic site pasted again (a later `updated_at`), the data site deleted and
    // pasted anew under the same code (a new row), the gas site left alone.
    const repasted = hoursAgo(1);
    const readded = hoursAgo(2);
    wandererRow('PKM-342').updated_at = repasted;
    Object.assign(wandererRow('EHX-232'), {
      id: 'c3b7c8f4-5d0e-4c4a-9d0a-222222222222',
      inserted_at: readded,
      updated_at: readded,
    });
    const pull = await map.pull();
    expect(pull.outcome.signatures).toMatchObject({ created: 0, updated: 0, removed: 0 });
    const after = await map.signatures();
    // No second record: each keeps its id, its times follow Wanderer's.
    expect(after.size).toBe(before.size);
    expect(after.get('PKM-342')).toMatchObject({
      id: before.get('PKM-342')!.id,
      createdAt: Date.parse(old),
      updatedAt: Date.parse(repasted),
    });
    expect(after.get('EHX-232')).toMatchObject({
      id: before.get('EHX-232')!.id,
      createdAt: Date.parse(readded),
      updatedAt: Date.parse(readded),
    });

    // The lazy delete counts from those: only the one Wanderer did not see for a day goes.
    expect(await sweep()).toMatchObject({ signatures: 1 });
    const left = await map.signatures();
    expect(left.has('PKM-342')).toBe(true);
    expect(left.has('EHX-232')).toBe(true);
    expect(left.has('NNV-694')).toBe(false);

    // Wanderer still lists it, not seen since the expiry counted: the sync does not bring it back,
    // so the two do not take turns.
    const again = await map.pull();
    expect(again.outcome.signatures).toMatchObject({ created: 0, removed: 0 });
    expect((await map.signatures()).has('NNV-694')).toBe(false);
    expect(await sweep()).toMatchObject({ signatures: 0 });
  }, 60_000);

  it('brings back what the sweeper let expire once Wanderer has seen it since, linked to its connection', async () => {
    await allowPrivate();
    // As on the map in production: first imported days ago ...
    const first = hoursAgo(72);
    for (const eveId of ['PKM-342', 'EHX-232', 'DKM-763'])
      Object.assign(wandererRow(eveId), { inserted_at: first, updated_at: first });
    // ... with a hole whose connection Wanderer did not have yet.
    const at = wanderer.map.connections.findIndex(
      (c) => c.solar_system_source === 31002531 && c.solar_system_target === 31000399,
    );
    const [connection] = wanderer.map.connections.splice(at, 1);
    const map = await syncing();
    expect((await map.signatures()).get('DKM-763')).toMatchObject({ connectionId: null, group: 'wormhole' });

    // In Wanderer: re-pasted yesterday evening (one as a new row under the same code), and the
    // hole linked to its connection overnight.
    const inserted = hoursAgo(19);
    const pasted = hoursAgo(18);
    const linked = hoursAgo(10);
    Object.assign(wandererRow('PKM-342'), {
      id: 'c3b7c8f4-5d0e-4c4a-9d0a-333333333333',
      inserted_at: inserted,
      updated_at: pasted,
    });
    wandererRow('EHX-232').updated_at = pasted;
    wandererRow('DKM-763').updated_at = linked;
    wanderer.map.connections.push(connection!);

    // The sweeper gets there before the next pull: here they look idle for three days.
    expect(await sweep()).toMatchObject({ signatures: 3 });
    const gone = await map.signatures();
    for (const eveId of ['PKM-342', 'EHX-232', 'DKM-763']) expect(gone.has(eveId)).toBe(false);
    expect(await map.tombstone('31002531:PKM-342')).toMatchObject({ expiredFrom: Date.parse(first) });

    // The pull brings them back with Wanderer's times, the hole linked to its connection.
    const pull = await map.pull();
    expect(pull.outcome.signatures).toMatchObject({ created: 3 });
    const back = await map.signatures();
    expect(back.get('PKM-342')).toMatchObject({
      createdAt: Date.parse(inserted),
      updatedAt: Date.parse(pasted),
    });
    expect(back.get('EHX-232')).toMatchObject({
      createdAt: Date.parse(first),
      updatedAt: Date.parse(pasted),
    });
    const hole = (await map.deps.target.connections(map.actor, map.mapId)).find(
      (c) => c.source === 31002531 && c.target === 31000399,
    );
    expect(back.get('DKM-763')).toMatchObject({
      connectionId: hole!.id,
      group: 'wormhole',
      updatedAt: Date.parse(linked),
    });

    // Judged again by when Wanderer last saw them: all within the day, and the hole stays while
    // its connection does. The next pull changes nothing.
    expect(await sweep()).toMatchObject({ signatures: 0 });
    const again = await map.pull();
    expect(again.outcome.signatures).toMatchObject({ created: 0, updated: 0, removed: 0 });
    expect((await map.signatures()).size).toBe(back.size);
  }, 60_000);

  it("does not undo a person's deletion, even of a signature Wanderer pasted again just before", async () => {
    await allowPrivate();
    const map = await syncing();
    wandererRow('PKM-342').updated_at = hoursAgo(0.1);
    const pkm = (await map.signatures()).get('PKM-342')!;
    await owner.request(`/api/maps/${map.mapId}/signatures/${pkm.id}`, { method: 'DELETE' });
    const tombstone = await map.tombstone('31002531:PKM-342');
    // On purpose: no expiry.
    expect(tombstone).toEqual({ deletedAt: expect.any(Number) });

    const pull = await map.pull();
    expect(pull.outcome.signatures!.created).toBe(0);
    expect((await map.signatures()).has('PKM-342')).toBe(false);
    await sweep();
    expect(await map.tombstone('31002531:PKM-342')).toEqual(tombstone);
  }, 60_000);

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
