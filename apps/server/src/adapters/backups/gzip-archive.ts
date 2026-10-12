import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import type { BackupArchive, DatabaseInspection, LocalFile } from '@darkbeacon/backups';
import { inspectSqliteFile, selfContained } from '@darkbeacon/db';
import { scratchFile } from './files.js';

const GZIP_MAGIC = [0x1f, 0x8b];
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');

/** Counts bytes going through, failing once there are more than `max`. */
class ByteLimit extends Transform {
  bytes = 0;

  constructor(
    private readonly max: number,
    private readonly what: string,
  ) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    this.bytes += chunk.length;
    if (this.bytes > this.max) done(new Error(`${this.what} is larger than ${this.max} bytes`));
    else done(null, chunk);
  }
}

/** Hashes bytes going through. */
class Sha256 extends Transform {
  private readonly hash = createHash('sha256');
  bytes = 0;

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    this.hash.update(chunk);
    this.bytes += chunk.length;
    done(null, chunk);
  }

  digest(): string {
    return this.hash.digest('hex');
  }
}

/** SHA-256 (hex) of a file, streamed. */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function head(path: string, length: number): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** gzip-compressed SQLite files with a SHA-256 of the compressed bytes. */
export class GzipBackupArchive implements BackupArchive {
  constructor(
    /** Where packed files are written before storage takes them. */
    private readonly scratchDir: string,
    /** Where unpacked databases go: next to the live database, so a swap is a rename. */
    private readonly stagingDir: string,
  ) {}

  async pack(database: LocalFile) {
    const file = scratchFile(this.scratchDir, 'pack', '.db.gz');
    const hash = new Sha256();
    try {
      await pipeline(
        createReadStream(database.path),
        createGzip({ level: 6 }),
        hash,
        createWriteStream(file.path),
      );
      return {
        file,
        size: hash.bytes,
        databaseSize: (await stat(database.path)).size,
        sha256: hash.digest(),
      };
    } catch (error) {
      await file.dispose();
      throw error;
    }
  }

  async unpack(file: LocalFile, maxBytes: number): Promise<LocalFile> {
    const start = await head(file.path, SQLITE_MAGIC.length);
    const gzip = start[0] === GZIP_MAGIC[0] && start[1] === GZIP_MAGIC[1];
    if (!gzip && !start.equals(SQLITE_MAGIC)) {
      throw new Error('the file is neither a Darkbeacon backup (.db.gz) nor a SQLite database');
    }
    const staged = scratchFile(this.stagingDir, 'restore', '.db');
    try {
      const limit = new ByteLimit(maxBytes, 'the database');
      if (gzip) {
        await pipeline(createReadStream(file.path), createGunzip(), limit, createWriteStream(staged.path));
      } else {
        await pipeline(createReadStream(file.path), limit, createWriteStream(staged.path));
      }
      selfContained(staged.path);
      return staged;
    } catch (error) {
      await staged.dispose();
      const text = error instanceof Error ? error.message : String(error);
      throw new Error(
        gzip && /incorrect header|unexpected end|invalid/i.test(text)
          ? `the gzip data is damaged (${text})`
          : text,
        { cause: error },
      );
    }
  }

  inspect(database: LocalFile, options: { quick?: boolean } = {}): Promise<DatabaseInspection> {
    return Promise.resolve().then(() => inspectSqliteFile(database.path, options));
  }
}

export { ByteLimit };
