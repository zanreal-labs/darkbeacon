import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import WebSocket from 'ws';
import { BackupService } from '@darkbeacon/backups';
import { createDatabase } from '@darkbeacon/db';
import { describeEachDialect } from '@darkbeacon/db/testing';
import {
  RESTORED_CLOSE_CODE,
  type AuditPageDto,
  type BackupDto,
  type BackupStatusDto,
  type MapDto,
  type MeDto,
  type RestoreResultDto,
  type ServerMessage,
} from '@darkbeacon/shared';
import { createApp } from '../../app.js';
import { MaintenanceMode } from '../../platform/maintenance.js';
import { parseEnv } from '../../config/config.js';
import { Browser } from '../../test-support/browser.js';
import { BackupScheduler } from './backups.module.js';

const B = '/api/admin/backups';

const configFor = (dataDir: string) => ({
  ...parseEnv({ NODE_ENV: 'test', PUBLIC_URL: 'http://dbk.test', DEMO_MODE: 'true', DATA_DIR: dataDir }),
  secretKey: 's'.repeat(32),
});

describe('backups over HTTP [sqlite file]', () => {
  let dir: string;
  let app: NestFastifyApplication;
  let base: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dbk-backups-e2e-'));
    app = await createApp(configFor(dir), { logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  const signIn = async (name: string) => {
    const browser = new Browser(base);
    const me = await browser.json<MeDto>('/api/auth/dev', {
      method: 'POST',
      json: { name, character: { name: `${name} Main` } },
    });
    return { browser, me };
  };

  const upload = (browser: Browser, bytes: Uint8Array, confirm = 'RESTORE') => {
    const form = new FormData();
    form.append('confirm', confirm);
    form.append('file', new Blob([bytes]), 'backup.db.gz');
    return browser.request(`${B}/restore-upload`, { method: 'POST', body: form });
  };

  it('backs up, lists, downloads, restores and deletes, and records all of it', async () => {
    const { browser: owner } = await signIn('owner');
    const map = await owner.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Before' } });

    const empty = await owner.json<BackupStatusDto>(B);
    expect(empty).toMatchObject({ supported: true, database: 'sqlite', backups: [], failing: false });
    expect(empty.directory).toBe(join(dir, 'backups'));
    expect(empty.settings).toMatchObject({ intervalMinutes: 1440, keep: 14 });

    const backup = await owner.json<BackupDto>(B, { method: 'POST' });
    expect(backup.trigger).toBe('manual');
    const listed = await owner.json<BackupStatusDto>(B);
    expect(listed.backups.map((b) => b.name)).toEqual([backup.name]);
    expect(listed.lastSuccess).toMatchObject({ name: backup.name });

    const download = await owner.request(`${B}/${backup.name}/download`);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain(backup.name);
    const bytes = new Uint8Array(await download.arrayBuffer());
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(backup.sha256);

    // Change the map, then restore while a realtime client follows it.
    await owner.json(`/api/maps/${map.id}`, { method: 'PATCH', json: { name: 'After' } });
    const socket = new WebSocket(`ws://${base}/ws`, { headers: { cookie: owner.cookieHeader } });
    const messages: ServerMessage[] = [];
    socket.on('message', (data) => messages.push(JSON.parse(String(data)) as ServerMessage));
    const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
    await new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject));
    socket.send(JSON.stringify({ op: 'subscribe', stream: `map:${map.id}` }));
    await vi.waitFor(() => expect(messages.some((m) => m.op === 'subscribed')).toBe(true));

    const unconfirmed = await owner.request(`${B}/${backup.name}/restore`, { method: 'POST', json: {} });
    expect(unconfirmed.status).toBe(400);

    const result = await owner.json<RestoreResultDto>(`${B}/${backup.name}/restore`, {
      method: 'POST',
      json: { confirm: 'RESTORE' },
    });
    expect(result.restored).toBe(backup.name);
    expect(await closed).toBe(RESTORED_CLOSE_CODE);
    expect((await owner.json<MapDto>(`/api/maps/${map.id}`)).name).toBe('Before');

    // The app keeps working: writes go through and a new socket gets a snapshot.
    await owner.json(`/api/maps/${map.id}`, { method: 'PATCH', json: { name: 'Again' } });
    const again = new WebSocket(`ws://${base}/ws`, { headers: { cookie: owner.cookieHeader } });
    const fresh: ServerMessage[] = [];
    again.on('message', (data) => fresh.push(JSON.parse(String(data)) as ServerMessage));
    await new Promise((resolve, reject) => again.once('open', resolve).once('error', reject));
    again.send(JSON.stringify({ op: 'subscribe', stream: `map:${map.id}` }));
    await vi.waitFor(() => expect(fresh.find((m) => m.op === 'snapshot')).toBeDefined());
    again.close();

    // Upload the downloaded file: back to "Before" again.
    const uploaded = await upload(owner, bytes);
    expect(uploaded.status).toBe(201);
    expect(await uploaded.json()).toMatchObject({ restored: 'upload' });
    expect((await owner.json<MapDto>(`/api/maps/${map.id}`)).name).toBe('Before');

    const status = await owner.json<BackupStatusDto>(B);
    expect(status.backups.map((b) => b.trigger).sort()).toEqual(['manual', 'pre-restore', 'pre-restore']);
    expect(status.lastRestore).toMatchObject({ name: 'upload' });

    const pre = status.backups.find((b) => b.trigger === 'pre-restore')!;
    expect((await owner.request(`${B}/${pre.name}`, { method: 'DELETE' })).status).toBe(204);
    expect((await owner.request(`${B}/${pre.name}`, { method: 'DELETE' })).status).toBe(404);

    const audit = await owner.json<AuditPageDto>('/api/admin/audit?limit=100');
    const types = audit.entries.map((e) => e.type);
    // The restored database's history goes on from the backup: its own sign-in, then the restore
    // and what came after it (the backup was taken before its own completion was recorded).
    expect(types).toEqual(['backup.deleted', 'backup.restored', 'auth.signed_in']);
    expect(audit.entries.find((e) => e.type === 'backup.restored')?.actor).toMatchObject({ kind: 'account' });
  });

  it('rejects corrupt, oversized-looking and unconfirmed uploads cleanly', async () => {
    const { browser: owner } = await signIn('owner');
    const garbage = await upload(owner, new TextEncoder().encode('not a backup at all'));
    expect(garbage.status).toBe(400);
    expect(await garbage.json()).toMatchObject({
      error: { code: 'validation', message: /not a Darkbeacon backup|neither/ },
    });

    const gzipped = await upload(owner, gzipSync(Buffer.from('SQLite format 3\0'.repeat(1000))));
    expect(gzipped.status).toBe(400);

    const unconfirmed = await upload(owner, gzipSync(Buffer.from('x')), 'yes');
    expect(unconfirmed.status).toBe(400);
    expect(await unconfirmed.json()).toMatchObject({ error: { message: /Type RESTORE/ } });

    const notMultipart = await owner.request(`${B}/restore-upload`, {
      method: 'POST',
      json: { confirm: 'RESTORE' },
    });
    expect(notMultipart.status).toBe(400);

    // Nothing was left behind and the instance is not marked as failing for refused files.
    expect(readdirSync(join(dir, 'backups', '.tmp'))).toEqual([]);
    expect(readdirSync(dir).filter((f) => f.startsWith('.restore'))).toEqual([]);
    expect((await owner.json<BackupStatusDto>(B)).failing).toBe(false);
    expect((await owner.json<{ status: string }>('/api/health')).status).toBe('ok');
  });

  it('is for instance admins only', async () => {
    const { browser: owner } = await signIn('owner');
    const backup = await owner.json<BackupDto>(B, { method: 'POST' });
    const { browser: user } = await signIn('user');
    const anonymous = new Browser(base);
    for (const [method, path] of [
      ['GET', B],
      ['POST', B],
      ['PATCH', `${B}/settings`],
      ['GET', `${B}/${backup.name}/download`],
      ['DELETE', `${B}/${backup.name}`],
      ['POST', `${B}/${backup.name}/restore`],
    ] as const) {
      const json = method === 'PATCH' ? { keep: 3 } : method === 'POST' ? { confirm: 'RESTORE' } : undefined;
      const forbidden = await user.request(path, { method, ...(json ? { json } : {}) });
      expect(forbidden.status, `${method} ${path}`).toBe(403);
    }
    expect((await upload(user, gzipSync(Buffer.from('x')))).status).toBe(403);
    expect((await anonymous.request(B)).status).toBe(401);
  });

  it('saves settings, never shows the alert webhook address, and schedules', async () => {
    const { browser: owner } = await signIn('owner');
    const settings = await owner.json(`${B}/settings`, {
      method: 'PATCH',
      json: { intervalMinutes: 360, keep: 3, notifyUrl: 'https://example.com/hooks/very-secret' },
    });
    expect(settings).toEqual({
      intervalMinutes: 360,
      keep: 3,
      maxAgeDays: null,
      notifyHost: 'example.com',
      notifySuccess: false,
    });
    const status = await owner.json<BackupStatusDto>(B);
    expect(JSON.stringify(status)).not.toContain('very-secret');
    expect(status.nextRunAt).not.toBeNull();

    await app.get(BackupScheduler).tick();
    const after = await owner.json<BackupStatusDto>(B);
    expect(after.backups.map((b) => b.trigger)).toEqual(['scheduled']);
    expect(after.nextRunAt).toBeGreaterThan(Date.now() + 5 * 60 * 60_000);

    const bad = await owner.request(`${B}/settings`, { method: 'PATCH', json: { intervalMinutes: 1 } });
    expect(bad.status).toBe(400);
  });
});

describe('maintenance mode [sqlite file]', () => {
  it('refuses writes and new sockets, shows a page, and lets reads through', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbk-maintenance-'));
    const app = await createApp(configFor(dir), { logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const base = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    try {
      const owner = new Browser(base);
      await owner.json('/api/auth/dev', {
        method: 'POST',
        json: { name: 'owner', character: { name: 'O' } },
      });
      const maintenance = app.get(MaintenanceMode);
      await maintenance.enter('test');

      const write = await owner.request('/api/maps', { method: 'POST', json: { name: 'Nope' } });
      expect(write.status).toBe(503);
      expect(await write.json()).toMatchObject({
        error: { code: 'unavailable', details: { maintenance: true } },
      });
      expect((await owner.request('/api/maps')).status).toBe(200);
      expect((await owner.request(B)).status).toBe(200);
      const socket = new WebSocket(`ws://${base}/ws`, { headers: { cookie: owner.cookieHeader } });
      expect(await new Promise((resolve) => socket.once('close', resolve))).toBe(1013);

      await maintenance.leave(false);
      expect((await owner.request('/api/maps', { method: 'POST', json: { name: 'Yes' } })).status).toBe(201);
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('backups at startup [sqlite file]', () => {
  it('backs up an existing database before running pending migrations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbk-backups-boot-'));
    const database = await createDatabase({ dataDir: dir });
    await database.migrate();
    // An older schema: one migration (and its tables) still to come.
    await database.exclusive(async (file) => {
      file.raw.exec('drop table routing_personal_hubs; drop table routing_map_hubs');
      file.raw.prepare(`delete from kysely_migration where name = 'routing/0001_hubs'`).run();
    });
    await database.close();

    const app = await createApp(configFor(dir), { logger: false });
    try {
      const files = readdirSync(join(dir, 'backups')).filter((f) => f.endsWith('.db.gz'));
      expect(files).toHaveLength(1);
      const status = await app.get(BackupService).status({ kind: 'account', id: 'x', instanceRole: 'owner' });
      expect(status.backups).toMatchObject([{ trigger: 'pre-migration' }]);
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describeEachDialect('backups without a database file', (t) => {
  let app: NestFastifyApplication;
  let base: string;

  beforeEach(async () => {
    app = await createApp(configFor(mkdtempSync(join(tmpdir(), 'dbk-backups-x-'))), {
      database: t.db,
      logger: false,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('says backups are not made here, and refuses to make one', async () => {
    const owner = new Browser(base);
    await owner.json('/api/auth/dev', { method: 'POST', json: { name: 'owner', character: { name: 'O' } } });
    const status = await owner.json<BackupStatusDto>(B);
    expect(status).toMatchObject({ supported: false, database: t.dialect, backups: [], nextRunAt: null });
    const create = await owner.request(B, { method: 'POST' });
    expect(create.status).toBe(409);
    if (t.dialect === 'postgres')
      expect(await create.json()).toMatchObject({ error: { message: /pg_dump/ } });
  });
});
