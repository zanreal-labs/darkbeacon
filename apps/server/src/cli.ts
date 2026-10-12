#!/usr/bin/env node
// The `darkbeacon` command: backups from a shell, for when the web UI is not an option.
//
//   docker exec -it <container> darkbeacon backup list
//   docker exec -it <container> darkbeacon backup create
//   docker run --rm -it -v <volume>:/data <image> darkbeacon backup restore <name or file>
//
// See docs/backups.md.
import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  assertRestorable,
  formatBytes,
  isBackupName,
  type BackupService,
  type LocalFile,
} from '@darkbeacon/backups';
import { systemClock, type Actor, type EventLog } from '@darkbeacon/core';
import { createDatabase, knownMigrations, type Database } from '@darkbeacon/db';
import { RESTORE_CONFIRMATION } from '@darkbeacon/shared';
import { InProcessEventBus } from './adapters/events/in-process-event-bus.js';
import { KyselyEventLog } from './adapters/events/kysely-event-log.js';
import {
  backupConfig,
  createBackupService,
  noMaintenance,
  noNotifier,
  scratchDirOf,
  type BackupConfig,
} from './adapters/backups/index.js';
import { GzipBackupArchive } from './adapters/backups/gzip-archive.js';
import { scratchFile } from './adapters/backups/files.js';
import { ConfigError, parseEnv } from './config/config.js';
import { APP_VERSION } from './platform/version.js';

const USAGE = `Usage: darkbeacon backup <command>

  list                      the backups in BACKUP_DIR, newest first
  create                    back the database up now (works while the server runs)
  restore <name|file>       replace the database with a backup from the list or any .db.gz /
                            SQLite file; the server must be stopped (use the web UI otherwise)
  verify <name|file>        check that a file can be restored, without restoring it

Options:
  --yes                     restore without asking to type ${RESTORE_CONFIRMATION}
  --force                   ignore a lock left by another backup or restore`;

/** The CLI acts as a system process of the server (recorded as such in the audit trail). */
const CLI: Actor = { kind: 'system', id: 'cli' };

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

async function serverAnswers(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

async function confirm(yes: boolean): Promise<string> {
  if (yes) return RESTORE_CONFIRMATION;
  if (!process.stdin.isTTY)
    fail(`Not a terminal: pass --yes to confirm the restore (or run with docker exec -it).`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (
      await rl.question(`This replaces the whole database. Type ${RESTORE_CONFIRMATION} to go on: `)
    ).trim();
  } finally {
    rl.close();
  }
}

async function main(argv: string[]): Promise<void> {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const [group, command, target] = argv.filter((a) => !a.startsWith('--'));
  if (flags.has('--help') || group !== 'backup' || !command) {
    console.log(USAGE);
    process.exit(group === undefined || flags.has('--help') ? 0 : 2);
  }

  let env;
  try {
    env = parseEnv(process.env);
  } catch (error) {
    if (error instanceof ConfigError) fail(error.message);
    throw error;
  }
  if (env.databaseUrl) {
    fail(
      'This instance runs on PostgreSQL: back it up with pg_dump and restore with psql (docs/backups.md).',
    );
  }
  const config = backupConfig(process.env, env.dataDir);
  const databaseFile = join(env.dataDir, 'app.db');
  if (command !== 'restore' && !existsSync(databaseFile)) fail(`No database at ${databaseFile}.`);

  if (command === 'restore' && (await serverAnswers(env.port))) {
    fail(
      'The server is running in this container. Restore from Admin > Backups, or stop the container and run\n' +
        `  docker run --rm -it -v <your volume>:/data <image> darkbeacon backup restore ${target ?? '<file>'}`,
    );
  }

  const database: Database = await createDatabase({ dataDir: env.dataDir });
  const service: BackupService = createBackupService({
    config,
    database,
    clock: systemClock,
    appVersion: APP_VERSION,
    // A database restored onto an empty volume gets its tables from the restore itself.
    events: command === 'list' || command === 'verify' ? null : auditLog(database),
    maintenance: noMaintenance,
    notifier: noNotifier,
    onError: (error) => console.warn(`warning: ${error instanceof Error ? error.message : String(error)}`),
    forceLock: flags.has('--force'),
    separateProcess: true,
  });

  try {
    switch (command) {
      case 'list': {
        const status = await service.status(CLI);
        if (status.backups.length === 0) console.log(`No backups in ${status.directory}.`);
        for (const b of status.backups) {
          console.log(
            `${b.name}  ${new Date(b.createdAt).toISOString()}  ${formatBytes(b.size).padStart(8)}  ${b.trigger}`,
          );
        }
        if (status.failing && status.lastFailure) {
          console.log(`\nLast ${status.lastFailure.operation} failed: ${status.lastFailure.message}`);
        }
        break;
      }
      case 'create': {
        const backup = await service.create(CLI);
        console.log(`${join(config.dir, backup.name)} (${formatBytes(backup.size)})`);
        break;
      }
      case 'verify':
      case 'restore': {
        if (!target) fail(`Which backup? darkbeacon backup ${command} <name|file>`);
        const named = isBackupName(target) && existsSync(join(config.dir, target));
        if (!named && !existsSync(target))
          fail(`No backup called ${target} in ${config.dir}, and no such file.`);
        if (command === 'verify') {
          await verify(config, named ? join(config.dir, target) : resolve(target));
          break;
        }
        const answer = await confirm(flags.has('--yes'));
        const result = named
          ? await service.restore(CLI, target, answer)
          : await service.restoreUpload(CLI, await copyIn(resolve(target), scratchDirOf(config)), answer);
        console.log(`Restored ${named ? target : basename(target)}.`);
        console.log(`The database before it is kept as ${join(config.dir, result.preRestore)}.`);
        if (result.migrationsApplied.length > 0)
          console.log(`Migrations run: ${result.migrationsApplied.join(', ')}`);
        break;
      }
      default:
        console.log(USAGE);
        process.exitCode = 2;
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await database.close();
  }
}

/** Restores consume the file they are given; the CLI hands them a copy. */
async function copyIn(path: string, dir: string): Promise<LocalFile> {
  const file = scratchFile(dir, 'upload', '.upload');
  await copyFile(path, file.path);
  return file;
}

/** Unpacks and inspects without restoring. */
async function verify(config: BackupConfig, path: string): Promise<void> {
  const archive = new GzipBackupArchive(scratchDirOf(config), scratchDirOf(config));
  const staged = await archive.unpack({ path, dispose: () => Promise.resolve() }, config.maxDatabaseBytes);
  try {
    const inspection = await archive.inspect(staged);
    assertRestorable(inspection, await knownMigrations());
    console.log(
      `OK: a Darkbeacon database with ${inspection.migrations.length} migrations; it can be restored.`,
    );
  } finally {
    await staged.dispose();
  }
}

/** Audit records go to the event log once it exists (a restore onto an empty volume creates it). */
function auditLog(database: Database): EventLog {
  const log = new KyselyEventLog(database, new InProcessEventBus());
  const ready = () =>
    !!database.sqlite?.raw
      .prepare(`select 1 from sqlite_master where type = 'table' and name = 'event_log'`)
      .get();
  return {
    append: (events) => (ready() ? log.append(events) : Promise.resolve([])),
    readSince: (...args) => log.readSince(...args),
    headSeq: (stream) => log.headSeq(stream),
    oldestSeq: (stream) => log.oldestSeq(stream),
    prune: (before) => log.prune(before),
  };
}

await main(process.argv.slice(2));
