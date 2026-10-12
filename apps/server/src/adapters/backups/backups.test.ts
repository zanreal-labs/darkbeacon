import { mkdtempSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BackupService, LocalFile, Maintenance } from '@darkbeacon/backups';
import { ConflictError, DomainError, ManualClock, ValidationError, type Actor } from '@darkbeacon/core';
import { createDatabase, inspectSqliteFile, openSqlite, type Database } from '@darkbeacon/db';
import { FileBackupLock } from './file-lock.js';
import { GzipBackupArchive } from './gzip-archive.js';
import { backupConfig, createBackupService, noNotifier, scratchDirOf } from './index.js';

interface Tables {
  event_stream: { stream: string; head_seq: number; head_hash: string | null };
}

const admin: Actor = { kind: 'account', id: 'admin', instanceRole: 'owner' };
const DAY = 24 * 60 * 60 * 1000;

class RecordingMaintenance implements Maintenance {
  readonly calls: string[] = [];
  enter(reason: string) {
    this.calls.push(`enter:${reason}`);
    return Promise.resolve();
  }
  leave(restored: boolean) {
    this.calls.push(`leave:${restored}`);
    return Promise.resolve();
  }
}

describe('SQLite backups (file adapters)', () => {
  let dir: string;
  let database: Database;
  let clock: ManualClock;
  let maintenance: RecordingMaintenance;
  let service: BackupService;

  const build = (env: NodeJS.ProcessEnv = {}) =>
    createBackupService({
      config: backupConfig(env, dir),
      database,
      clock,
      appVersion: '0.1.0',
      events: null,
      maintenance,
      notifier: noNotifier,
      onError: (error) => {
        throw error;
      },
    });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dbk-backups-'));
    database = await createDatabase({ dataDir: dir });
    await database.migrate();
    clock = new ManualClock(Date.UTC(2026, 9, 12, 10, 0, 0));
    maintenance = new RecordingMaintenance();
    service = build();
  });

  afterEach(async () => {
    await database.close();
    await rm(dir, { recursive: true, force: true });
  });

  const db = () => database.db<Tables>();
  const streams = async () =>
    (await db().selectFrom('event_stream').select('stream').orderBy('stream').execute()).map((r) => r.stream);
  const write = (stream: string) =>
    db().insertInto('event_stream').values({ stream, head_seq: 1, head_hash: null }).execute();
  const backupFile = (name: string) => join(dir, 'backups', name);
  /** A file to upload, written outside the backup directory. */
  const upload = (bytes: Buffer): LocalFile => {
    const path = join(dir, `upload-${Math.random().toString(36).slice(2)}`);
    writeFileSync(path, bytes);
    return { path, dispose: () => rm(path, { force: true }) };
  };
  /** A copy of the live database, changed by `edit`, as an uploadable `.db.gz`. */
  const editedCopy = async (edit: (sqlite: ReturnType<typeof openSqlite>) => void): Promise<LocalFile> => {
    const copy = join(dir, 'copy.db');
    await database.exclusive((file) => file.backupTo(copy));
    const sqlite = openSqlite(copy);
    edit(sqlite);
    sqlite.pragma('journal_mode = DELETE');
    sqlite.close();
    const file = upload(gzipSync(readFileSync(copy)));
    await rm(copy, { force: true });
    return file;
  };

  it('takes a consistent snapshot while transactions keep committing', async () => {
    let stop = false;
    let written = 0;
    // Each transaction writes a pair with a pause in between, so a torn copy would hold half a pair.
    const writer = (async () => {
      for (let i = 0; !stop; i++) {
        await database.transaction(async () => {
          await write(`pair:${i}:a`);
          await new Promise((resolve) => setImmediate(resolve));
          await write(`pair:${i}:b`);
        });
        written++;
      }
    })();
    while (written < 20) await new Promise((resolve) => setImmediate(resolve));
    const backups = await Promise.all([
      service.create(admin),
      new Promise((r) => setTimeout(r, 5)).then(() => service.create(admin).catch((e: unknown) => e)),
    ]);
    stop = true;
    await writer;
    const first = backups[0];
    expect(first.trigger).toBe('manual');
    // The second "Back up now" came while the first held the lock, or right after it.
    if (backups[1] instanceof Error) expect(backups[1]).toBeInstanceOf(ConflictError);

    const archive = new GzipBackupArchive(scratchDirOf(backupConfig({}, dir)), dir);
    const unpacked = await archive.unpack({ path: backupFile(first.name), dispose: async () => {} }, 1e9);
    const inspection = inspectSqliteFile(unpacked.path);
    expect(inspection.integrity).toEqual(['ok']);
    const copy = openSqlite(unpacked.path);
    const pairs = (
      copy.prepare(`select stream from event_stream where stream like 'pair:%'`).all() as Array<{
        stream: string;
      }>
    ).map((r) => r.stream);
    copy.close();
    await unpacked.dispose();
    expect(pairs.length).toBeGreaterThanOrEqual(40);
    expect(pairs.length % 2).toBe(0);
    for (const a of pairs.filter((p) => p.endsWith(':a'))) expect(pairs).toContain(a.replace(/a$/, 'b'));
    expect(written * 2).toBeGreaterThanOrEqual(pairs.length);
  });

  it('copies the database while a transaction is open, without what it has not committed', async () => {
    await write('before');
    const copy = join(dir, 'open-copy.db');
    // The snapshot no longer holds the server's connections: it runs inside an open write.
    await database.transaction(async () => {
      await write('uncommitted');
      await database.sqlite!.copyTo(copy);
    });
    const sqlite = openSqlite(copy);
    const streams = (
      sqlite.prepare('select stream from event_stream').all() as Array<{ stream: string }>
    ).map((r) => r.stream);
    sqlite.close();
    expect(streams).toContain('before');
    expect(streams).not.toContain('uncommitted');
    expect(existsSync(`${copy}-wal`)).toBe(false);
    await rm(copy, { force: true });
  });

  it('writes a gzip file with a manifest: size, sha256, versions, trigger', async () => {
    const backup = await service.create(admin);
    expect(backup.name).toMatch(/^darkbeacon-20261012T100000Z-v0\.1\.0-s\d+\.db\.gz$/);
    const bytes = readFileSync(backupFile(backup.name));
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    expect(bytes.length).toBe(backup.size);
    const manifest = JSON.parse(readFileSync(`${backupFile(backup.name)}.json`, 'utf8')) as typeof backup;
    expect(manifest).toEqual(backup);
    expect(backup.schemaVersion).toBe((await database.migrationStatus()).applied.length);
    expect(readdirSync(join(dir, 'backups', '.tmp'))).toEqual([]);
  });

  it('prunes automatic backups beyond the retention and keeps manual ones', async () => {
    service = build({ BACKUP_SCHEDULE: 'daily', BACKUP_RETENTION: '2' });
    const manual = await service.create(admin);
    const scheduled = [];
    for (let day = 0; day < 4; day++) {
      clock.advance(DAY);
      scheduled.push(await service.runScheduled());
      // Not due again until a day later.
      expect(await service.runScheduled()).toBeNull();
    }
    const left = (await service.status(admin)).backups.map((b) => b.name).sort();
    expect(left).toEqual([manual.name, scheduled[2]!.name, scheduled[3]!.name].sort());
  });

  it('runs one scheduled backup at a time, and nothing else meanwhile', async () => {
    const [a, b] = await Promise.all([service.runScheduled(), service.runScheduled()]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((await service.status(admin)).backups).toHaveLength(1);

    // Another process (the CLI) holds the lock: a live pid on this host.
    const lockFile = join(dir, 'backups', '.lock');
    writeFileSync(
      lockFile,
      JSON.stringify({ operation: 'restore', startedAt: clock.now(), pid: process.ppid, host: hostname() }),
    );
    await expect(service.create(admin)).rejects.toThrow(ConflictError);
    clock.advance(2 * DAY);
    expect(await service.runScheduled()).toBeNull();
    expect((await service.status(admin)).running).toMatchObject({ operation: 'restore' });

    // A lock left by a process that is gone is taken over.
    writeFileSync(
      lockFile,
      JSON.stringify({ operation: 'backup', startedAt: clock.now(), pid: 2 ** 22 + 7, host: hostname() }),
    );
    await expect(service.create(admin)).resolves.toMatchObject({ trigger: 'manual' });
    expect(existsSync(lockFile)).toBe(false);
  });

  it('restores a backup: the data comes back, the database before it is kept', async () => {
    await write('before');
    const backup = await service.create(admin);
    await write('after');
    await db().deleteFrom('event_stream').where('stream', '=', 'before').execute();
    expect(await streams()).toEqual(['after']);

    clock.advance(1000);
    const result = await service.restore(admin, backup.name, 'RESTORE');
    expect(await streams()).toEqual(['before']);
    expect(result.migrationsApplied).toEqual([]);
    expect(maintenance.calls).toEqual([`enter:restoring ${backup.name}`, 'leave:true']);
    const status = await service.status(admin);
    const pre = status.backups.find((b) => b.name === result.preRestore)!;
    expect(pre.trigger).toBe('pre-restore');
    expect(status.lastRestore).toMatchObject({ name: backup.name, operation: 'restore' });
    expect(readdirSync(dir).filter((f) => f.includes('rollback') || f.startsWith('.restore'))).toEqual([]);

    // The pre-restore backup holds the state that was replaced, and can be restored in turn.
    await service.restore(admin, pre.name, 'RESTORE');
    expect(await streams()).toEqual(['after']);
  });

  it('restores an upload of an older schema and runs its migrations', async () => {
    await write('kept');
    const older = await editedCopy((sqlite) => {
      sqlite.exec(`drop table routing_personal_hubs; drop table routing_map_hubs`);
      sqlite.prepare(`delete from kysely_migration where name = 'routing/0001_hubs'`).run();
    });
    await write('lost');
    const result = await service.restoreUpload(admin, older, 'RESTORE');
    expect(result.migrationsApplied).toEqual(['routing/0001_hubs']);
    expect(await streams()).toEqual(['kept']);
    expect(existsSync(older.path)).toBe(false);
  });

  it('rolls back to the database as it was when the restored one fails to migrate', async () => {
    await write('current');
    // Says a migration is pending although its tables exist: running it fails.
    const broken = await editedCopy((sqlite) => {
      sqlite.prepare(`delete from kysely_migration where name = 'routing/0001_hubs'`).run();
      sqlite.prepare(`delete from event_stream`).run();
    });
    const error = await service.restoreUpload(admin, broken, 'RESTORE').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as Error).message).toMatch(/rolled back/);
    expect(await streams()).toEqual(['current']);
    await write('still writable');
    expect(maintenance.calls).toEqual(['enter:restoring upload', 'leave:false']);
    const status = await service.status(admin);
    expect(status.failing).toBe(true);
    expect(status.lastFailure).toMatchObject({ operation: 'restore' });
    expect(status.backups.map((b) => b.trigger)).toEqual(['pre-restore']);
    expect(readdirSync(dir).filter((f) => f.includes('rollback') || f.startsWith('.restore'))).toEqual([]);
  });

  it('refuses corrupt, foreign and newer files before touching anything', async () => {
    await write('current');
    const foreignPath = join(dir, 'foreign.db');
    const foreign = openSqlite(foreignPath);
    foreign.exec('create table users (id integer primary key)');
    foreign.pragma('journal_mode = DELETE');
    foreign.close();
    const damaged = await editedCopy(() => undefined);
    const damagedDb = gzipSync(
      (() => {
        const bytes = Buffer.from(gunzipSync(readFileSync(damaged.path)));
        // Scribble over the b-tree pages after the header page.
        for (let i = 4096; i < Math.min(bytes.length, 4096 * 6); i += 7) bytes[i] = 0xa5;
        return bytes;
      })(),
    );
    const cases: Array<[string, LocalFile, RegExp]> = [
      ['random bytes', upload(Buffer.from('definitely not a backup')), /neither a Darkbeacon backup/],
      [
        'gzip of garbage',
        upload(gzipSync(Buffer.from('SQLite format 3\0 but not really'.repeat(10)))),
        /backup/,
      ],
      ['truncated gzip', upload(readFileSync(damaged.path).subarray(0, 200)), /damaged|backup/],
      ['damaged pages', upload(damagedDb), /damaged|backup/],
      ['another application', upload(gzipSync(readFileSync(foreignPath))), /not a Darkbeacon database/],
      [
        'a newer Darkbeacon',
        await editedCopy((sqlite) =>
          sqlite
            .prepare(
              `insert into kysely_migration (name, timestamp) values ('zzz/9999_future', '2030-01-01')`,
            )
            .run(),
        ),
        /newer Darkbeacon/,
      ],
    ];
    for (const [what, file, reason] of cases) {
      const error = await service.restoreUpload(admin, file, 'RESTORE').catch((e: unknown) => e);
      expect(error, what).toBeInstanceOf(ValidationError);
      expect((error as Error).message, what).toMatch(reason);
      expect(existsSync(file.path), `${what}: upload removed`).toBe(false);
    }
    await damaged.dispose();
    expect(maintenance.calls).toEqual([]);
    expect(await streams()).toEqual(['current']);
    expect((await service.status(admin)).backups).toEqual([]);
    expect(readdirSync(dir).filter((f) => f.startsWith('.restore'))).toEqual([]);
  });

  it('asks for the confirmation and an admin', async () => {
    const backup = await service.create(admin);
    await expect(service.restore(admin, backup.name, 'restore')).rejects.toThrow(/Type RESTORE/);
    const user: Actor = { kind: 'account', id: 'u', instanceRole: 'user' };
    await expect(service.restore(user, backup.name, 'RESTORE')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(service.create(user)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(service.status(null)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(service.restore(admin, '../app.db', 'RESTORE')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses a stored backup whose bytes changed since it was made', async () => {
    const backup = await service.create(admin);
    const path = backupFile(backup.name);
    const bytes = readFileSync(path);
    bytes[bytes.length - 10] = (bytes[bytes.length - 10] ?? 0) ^ 0xff;
    writeFileSync(path, bytes);
    await expect(service.restore(admin, backup.name, 'RESTORE')).rejects.toThrow(/checksum/);
    expect(maintenance.calls).toEqual([]);
  });

  it('adopts a backup copied into the directory by hand', async () => {
    const backup = await service.create(admin);
    await rm(`${backupFile(backup.name)}.json`);
    const listed = (await service.status(admin)).backups;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ name: backup.name, sha256: backup.sha256, trigger: 'manual' });
  });

  it('keeps the lock file free between operations', async () => {
    const lock = new FileBackupLock(join(dir, 'backups'));
    const release = await lock.acquire('backup');
    await expect(lock.acquire('restore')).rejects.toThrow(ConflictError);
    await release();
    await (
      await lock.acquire('restore')
    )();
  });
});
