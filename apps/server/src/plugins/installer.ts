import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { ValidationError } from '@wormwright/core';
import { MANIFEST_FILE, parseManifest, type PluginManifest } from '@wormwright/plugin-sdk';
import type {
  CatalogEntry,
  PackageSource,
  PluginInstaller,
  PluginManifestSummary,
  StagedPackage,
} from '@wormwright/plugins';
import { THEME_MANIFEST_FILE, parseThemeManifest } from '@wormwright/theme-sdk';
import { x as extractTar } from 'tar';

/** First-party packages (`plugins/` at the repository root), seen from apps/server/(src|dist)/plugins/. */
export const CATALOG_DIR = fileURLToPath(new URL('../../../../plugins', import.meta.url));

const MAX_DOWNLOAD = 20 * 1024 * 1024;
const MAX_UNPACKED = 100 * 1024 * 1024;
/** Tar entry types worth unpacking; links and devices are skipped. */
const UNPACKED_TYPES = new Set(['File', 'OldFile', 'ContiguousFile', 'Directory']);
/** Not copied from a catalogue package: sources and build leftovers (tests, .tsbuildinfo too). */
const CATALOG_SKIP = new Set(['node_modules', 'src', 'tsconfig.json']);

export interface FileInstallerOptions {
  /** DATA_DIR/plugins */
  pluginsDir: string;
  catalogDir?: string;
  registryUrl?: string;
}

/**
 * Installs packages into `<pluginsDir>/<id>`. Everything is unpacked into
 * `<pluginsDir>/.staging/<uuid>` first and validated there, so a bad package never touches
 * an installed plugin.
 */
export class FilePluginInstaller implements PluginInstaller {
  private readonly stagingDir: string;
  private readonly catalogDir: string;
  private readonly registryUrl: string;

  constructor(private readonly options: FileInstallerOptions) {
    this.stagingDir = join(options.pluginsDir, '.staging');
    this.catalogDir = options.catalogDir ?? CATALOG_DIR;
    this.registryUrl = (options.registryUrl ?? 'https://registry.npmjs.org').replace(/\/+$/, '');
  }

  pluginDir(id: string): string {
    return join(this.options.pluginsDir, id);
  }

  async stage(source: PackageSource): Promise<StagedPackage> {
    const root = join(this.stagingDir, randomUUID());
    await mkdir(root, { recursive: true });
    try {
      if (source.kind === 'catalog') await this.copyFromCatalog(source.name, root);
      else if (source.kind === 'upload') await unpack(source.data, root);
      else await unpack(await this.download(source.name, source.version), root);
      return await readPackage(await packageRoot(root));
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }

  async commit(staged: StagedPackage): Promise<void> {
    if (staged.kind !== 'plugin') return;
    const target = this.pluginDir(staged.manifest.id);
    const old = join(this.stagingDir, `old-${randomUUID()}`);
    if (existsSync(target)) await rename(target, old);
    await rename(staged.directory, target);
    await rm(old, { recursive: true, force: true });
    await this.discard(staged);
  }

  async discard(staged: StagedPackage): Promise<void> {
    const [first] = relative(this.stagingDir, staged.directory).split(sep);
    if (first && first !== '..') await rm(join(this.stagingDir, first), { recursive: true, force: true });
  }

  async remove(pluginId: string): Promise<void> {
    await rm(this.pluginDir(pluginId), { recursive: true, force: true });
  }

  async catalog(): Promise<CatalogEntry[]> {
    if (!existsSync(this.catalogDir)) return [];
    const entries: CatalogEntry[] = [];
    for (const dir of (await readdir(this.catalogDir, { withFileTypes: true })).filter((d) =>
      d.isDirectory(),
    )) {
      try {
        const pkg = await readPackage(join(this.catalogDir, dir.name));
        const info = pkg.kind === 'plugin' ? pkg.manifest : pkg.theme;
        entries.push({
          source: `catalog:${dir.name}`,
          kind: pkg.kind,
          id: info.id,
          name: info.name,
          version: info.version,
          description: pkg.kind === 'plugin' ? pkg.manifest.description : null,
        });
      } catch {
        // Not a package, or a plugin that has not been built yet.
      }
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async copyFromCatalog(name: string, root: string): Promise<void> {
    const from = join(this.catalogDir, name);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || !existsSync(from)) {
      throw new ValidationError(`No catalogue entry "${name}"`);
    }
    await cp(from, root, {
      recursive: true,
      filter: (path) => {
        const rel = relative(from, path);
        return !CATALOG_SKIP.has(rel.split(sep)[0] ?? '') && !/\.test\.|\.tsbuildinfo$/.test(rel);
      },
    });
  }

  /** Fetches `name` at an exact version or dist-tag (default `latest`) and checks its integrity. */
  private async download(name: string, version: string | null): Promise<Uint8Array> {
    const response = await fetch(`${this.registryUrl}/${name.replace('/', '%2f')}`, {
      headers: { accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8' },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) throw new ValidationError(`npm has no package "${name}"`);
    if (!response.ok) throw new Error(`npm registry answered ${response.status} for ${name}`);
    const doc = (await response.json()) as {
      'dist-tags'?: Record<string, string>;
      versions?: Record<string, { dist?: { tarball?: string; integrity?: string; shasum?: string } }>;
    };
    const wanted = version ?? 'latest';
    const resolved = doc.versions?.[wanted] ? wanted : doc['dist-tags']?.[wanted];
    const dist = resolved ? doc.versions?.[resolved]?.dist : undefined;
    if (!dist?.tarball) throw new ValidationError(`npm has no version "${wanted}" of "${name}"`);

    const tarball = await fetch(dist.tarball, { signal: AbortSignal.timeout(60_000) });
    if (!tarball.ok) throw new Error(`downloading ${dist.tarball} failed with ${tarball.status}`);
    const bytes = await readLimited(tarball, MAX_DOWNLOAD);
    if (!checkIntegrity(bytes, dist.integrity, dist.shasum)) {
      throw new ValidationError(`The tarball of ${name}@${resolved} does not match its integrity hash`);
    }
    return bytes;
  }
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > limit) throw new ValidationError(`Package is larger than ${limit / 1024 / 1024} MB`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function checkIntegrity(bytes: Uint8Array, integrity?: string, shasum?: string): boolean {
  const sri = integrity?.split(/\s+/).find((s) => s.startsWith('sha512-'));
  if (sri) return createHash('sha512').update(bytes).digest('base64') === sri.slice('sha512-'.length);
  if (shasum) return createHash('sha1').update(bytes).digest('hex') === shasum;
  return false;
}

/** Unpacks a .tgz; only files and directories, inside `root`, within the size limit. */
export async function unpack(data: Uint8Array, root: string): Promise<void> {
  let unpacked = 0;
  try {
    await pipeline(
      Readable.from([Buffer.from(data)]),
      extractTar({
        cwd: root,
        strict: true,
        filter: (_path, entry) => {
          const type = 'type' in entry ? entry.type : 'File';
          unpacked += entry.size ?? 0;
          return UNPACKED_TYPES.has(type) && unpacked <= MAX_UNPACKED;
        },
      }),
    );
  } catch (error) {
    throw new ValidationError(`Not a valid .tgz package: ${error instanceof Error ? error.message : error}`);
  }
  if (unpacked > MAX_UNPACKED) throw new ValidationError('Package is too large once unpacked');
}

const MANIFESTS = [MANIFEST_FILE, THEME_MANIFEST_FILE];

/** The manifest sits at the root, or in the one folder npm tarballs wrap packages in (`package/`). */
async function packageRoot(root: string): Promise<string> {
  if (MANIFESTS.some((m) => existsSync(join(root, m)))) return root;
  const dirs = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory());
  if (dirs.length === 1 && MANIFESTS.some((m) => existsSync(join(root, dirs[0]!.name, m)))) {
    return join(root, dirs[0]!.name);
  }
  throw new ValidationError(`The package has no ${MANIFEST_FILE} or ${THEME_MANIFEST_FILE}`);
}

/** Reads and validates the manifest of an unpacked package. */
export async function readPackage(directory: string): Promise<StagedPackage> {
  if (existsSync(join(directory, THEME_MANIFEST_FILE))) {
    const result = parseThemeManifest(await readJson(join(directory, THEME_MANIFEST_FILE)));
    if (!result.ok) throw new ValidationError('Invalid theme manifest', result.errors);
    const { id, name, version, colorScheme, extends: base, tokens } = result.manifest;
    return { kind: 'theme', directory, theme: { id, name, version, colorScheme, extends: base, tokens } };
  }
  const result = parseManifest(await readJson(join(directory, MANIFEST_FILE)));
  if (!result.ok) throw new ValidationError('Invalid plugin manifest', result.errors);
  const m = result.manifest;
  for (const file of [m.server, m.web, m.settings, m.migrations]) {
    if (file !== undefined && !(await exists(join(directory, file)))) {
      throw new ValidationError(`The manifest names ${file}, which is not in the package`);
    }
  }
  return { kind: 'plugin', directory, manifest: summarize(m) };
}

export function summarize(m: PluginManifest): PluginManifestSummary {
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    description: m.description ?? null,
    server: m.server ?? null,
    web: m.web ?? null,
    settings: m.settings ?? null,
    migrations: m.migrations ?? null,
    ports: m.ports,
    events: m.events,
  };
}

export async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch (error) {
    throw new ValidationError(`Cannot read ${file.split(sep).slice(-1)[0]}: ${(error as Error).message}`);
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}
