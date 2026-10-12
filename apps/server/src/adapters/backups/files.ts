import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { LocalFile } from '@darkbeacon/backups';

/** A path for a temporary file in `dir` (created when missing); `dispose` removes it. */
export function scratchFile(dir: string, prefix: string, extension: string): LocalFile {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `.${prefix}-${randomUUID()}${extension}`);
  return {
    path,
    dispose: async () => {
      // SQLite may have left a -wal/-shm next to a database file.
      for (const suffix of ['', '-wal', '-shm', '-journal']) await rm(`${path}${suffix}`, { force: true });
    },
  };
}

/** A file somebody else owns: disposing it leaves it alone. */
export function borrowedFile(path: string): LocalFile {
  return { path, dispose: () => Promise.resolve() };
}
