import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { LEGACY_MANIFEST_FILE, MANIFEST_FILE } from '@darkbeacon/plugin-sdk';
import { LEGACY_THEME_MANIFEST_FILE, THEME_MANIFEST_FILE } from '@darkbeacon/theme-sdk';

const FILES = {
  plugin: [MANIFEST_FILE, LEGACY_MANIFEST_FILE],
  theme: [THEME_MANIFEST_FILE, LEGACY_THEME_MANIFEST_FILE],
} as const;

const logger = new Logger('Plugins');
const warned = new Set<string>();

/**
 * Path of a package's plugin or theme manifest, or null when it has none. Packages built before the
 * rename still carry the old file name; it is read, with one deprecation warning per directory.
 */
export function manifestPath(directory: string, kind: keyof typeof FILES): string | null {
  const [current, legacy] = FILES[kind];
  if (existsSync(join(directory, current))) return join(directory, current);
  if (!existsSync(join(directory, legacy))) return null;
  if (!warned.has(directory)) {
    warned.add(directory);
    logger.warn(`${directory}: ${legacy} is deprecated, rename it to ${current}`);
  }
  return join(directory, legacy);
}

export function hasManifest(directory: string): boolean {
  return manifestPath(directory, 'theme') !== null || manifestPath(directory, 'plugin') !== null;
}
