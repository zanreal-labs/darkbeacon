import { createReadStream, mkdirSync } from 'node:fs';
import { copyFile, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ValidationError } from '@darkbeacon/core';
import {
  isBackupName,
  type BackupManifest,
  type BackupStorage,
  type ByteStream,
  type LocalFile,
} from '@darkbeacon/backups';
import { BackupDto } from '@darkbeacon/shared';
import { borrowedFile } from './files.js';
import { sha256File } from './gzip-archive.js';

const NAME_PARTS = /^darkbeacon-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-v(.+)-s(\d+)(?:-\d+)?\.db\.gz$/;

/**
 * Backups as files in one directory: `<name>` (the gzip) and `<name>.json` (its manifest).
 * A backup copied into the directory by hand without a manifest gets one on the next listing
 * (as a manual backup, so retention never removes it).
 */
export class FileBackupStorage implements BackupStorage {
  constructor(readonly location: string) {}

  private dir(): string {
    mkdirSync(this.location, { recursive: true });
    return this.location;
  }

  async list(): Promise<BackupManifest[]> {
    const files = new Set(await readdir(this.dir()));
    const backups: BackupManifest[] = [];
    for (const name of files) {
      if (!isBackupName(name)) continue;
      const manifest = files.has(`${name}.json`) ? await this.readManifest(name) : await this.adopt(name);
      if (manifest) backups.push(manifest);
    }
    return backups;
  }

  async get(name: string): Promise<BackupManifest | null> {
    if (!isBackupName(name)) return null;
    try {
      await stat(join(this.dir(), name));
    } catch {
      return null;
    }
    return (await this.readManifest(name)) ?? (await this.adopt(name));
  }

  async put(manifest: BackupManifest, packed: LocalFile): Promise<void> {
    if (!isBackupName(manifest.name)) throw new Error(`invalid backup name ${manifest.name}`);
    const target = join(this.dir(), manifest.name);
    try {
      await rename(packed.path, target);
    } catch {
      // Another file system: copy, then let the caller remove the scratch file.
      await copyFile(packed.path, `${target}.partial`);
      await rename(`${target}.partial`, target);
    }
    await this.writeManifest(manifest);
  }

  async fetch(name: string): Promise<LocalFile> {
    const manifest = await this.get(name);
    if (!manifest) throw new Error(`backup ${name} not found`);
    const path = join(this.dir(), name);
    if ((await sha256File(path)) !== manifest.sha256) {
      throw new ValidationError(
        'The backup file does not match its checksum: it was changed or damaged since it was made',
        { reason: 'checksum' },
      );
    }
    return borrowedFile(path);
  }

  read(name: string): Promise<ByteStream> {
    return Promise.resolve(createReadStream(join(this.dir(), name)));
  }

  async remove(name: string): Promise<boolean> {
    if (!isBackupName(name)) return false;
    const path = join(this.dir(), name);
    const existed = await stat(path).then(
      () => true,
      () => false,
    );
    await rm(path, { force: true });
    await rm(`${path}.json`, { force: true });
    return existed;
  }

  private async readManifest(name: string): Promise<BackupManifest | null> {
    try {
      const parsed = BackupDto.safeParse(
        JSON.parse(await readFile(join(this.dir(), `${name}.json`), 'utf8')),
      );
      return parsed.success && parsed.data.name === name ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private async writeManifest(manifest: BackupManifest): Promise<void> {
    const path = join(this.dir(), `${manifest.name}.json`);
    await writeFile(`${path}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(`${path}.tmp`, path);
  }

  /** A manifest for a file without one, read from its name and contents. */
  private async adopt(name: string): Promise<BackupManifest | null> {
    const parts = NAME_PARTS.exec(name);
    if (!parts) return null;
    const [, y, mo, d, h, mi, s, appVersion, schema] = parts;
    const path = join(this.dir(), name);
    try {
      const info = await stat(path);
      const manifest: BackupManifest = {
        name,
        createdAt: Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)),
        size: info.size,
        databaseSize: 0,
        sha256: await sha256File(path),
        appVersion: appVersion!,
        schemaVersion: Number(schema),
        trigger: 'manual',
      };
      await this.writeManifest(manifest);
      return manifest;
    } catch {
      return null;
    }
  }
}
