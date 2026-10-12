import { mkdirSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { ConflictError } from '@darkbeacon/core';
import type { BackupLock } from '@darkbeacon/backups';

interface Holder {
  operation: 'backup' | 'restore';
  startedAt: number;
  pid: number;
  host: string;
}

/** A lock left by another container (which cannot be asked whether it lives) expires after this. */
const FOREIGN_STALE_MS = 60 * 60_000;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * One backup or restore at a time: a flag inside the process and a `.lock` file next to the
 * backups for other processes (the CLI run with `docker exec`). A lock file whose process is
 * gone is taken over.
 */
export class FileBackupLock implements BackupLock {
  private held: Holder | null = null;

  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now,
    /** The CLI's `--force`: take the lock whatever the file says. */
    private readonly force = false,
  ) {}

  private get file(): string {
    return join(this.dir, '.lock');
  }

  async acquire(operation: 'backup' | 'restore'): Promise<() => Promise<void>> {
    if (this.held) throw busy(this.held);
    const holder: Holder = { operation, startedAt: this.now(), pid: process.pid, host: hostname() };
    this.held = holder;
    try {
      mkdirSync(this.dir, { recursive: true });
      for (let attempt = 0; ; attempt++) {
        try {
          await writeFile(this.file, JSON.stringify(holder), { flag: 'wx' });
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 0) throw error;
          const other = await this.read();
          if (other && !this.force && !this.stale(other)) throw busy(other);
          await rm(this.file, { force: true });
        }
      }
    } catch (error) {
      this.held = null;
      if (error instanceof ConflictError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw busy(holder);
      throw error;
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      this.held = null;
      await rm(this.file, { force: true });
    };
  }

  async current(): Promise<{ operation: 'backup' | 'restore'; startedAt: number } | null> {
    const holder = this.held ?? (await this.read());
    if (!holder || (holder !== this.held && this.stale(holder))) return null;
    return { operation: holder.operation, startedAt: holder.startedAt };
  }

  private async read(): Promise<Holder | null> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as Holder;
    } catch {
      return null;
    }
  }

  private stale(holder: Holder): boolean {
    if (holder.host === hostname()) {
      // Our own pid in a file we do not hold: left by an earlier run of this container.
      return holder.pid === process.pid || !alive(holder.pid);
    }
    return this.now() - holder.startedAt > FOREIGN_STALE_MS;
  }
}

function busy(holder: { operation: string; startedAt: number }): ConflictError {
  return new ConflictError(
    `A ${holder.operation} is already running (since ${new Date(holder.startedAt).toISOString()})`,
  );
}
