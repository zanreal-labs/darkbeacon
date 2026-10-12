import { mkdirSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { EMPTY_BACKUP_STATE, type BackupState, type BackupStateStore } from '@darkbeacon/backups';

/**
 * The module's state as a JSON file next to the backups (`backups.json`, readable by the owner
 * only: it holds the alert webhook address). Writes go through a rename, so a crash leaves the
 * old file or the new one. Writes are serialized within the process.
 */
export class FileBackupStateStore implements BackupStateStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  async load(): Promise<BackupState> {
    await this.queue;
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Partial<BackupState>;
      return { ...EMPTY_BACKUP_STATE, ...parsed, settings: { ...parsed.settings } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY_BACKUP_STATE, settings: {} };
      throw error;
    }
  }

  save(state: BackupState): Promise<void> {
    const write = this.queue.then(async () => {
      mkdirSync(dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
    });
    this.queue = write.catch(() => undefined);
    return write;
  }
}
