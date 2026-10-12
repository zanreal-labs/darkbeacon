import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JumpSpaceSource } from '@darkbeacon/jumps';
import { KSPACE_DATA_FILE, type KspaceData } from '@darkbeacon/sde';

/**
 * The k-space dataset: `DATA_DIR/kspace.json` when an operator put one there (like
 * `universe.json`), else the one committed in packages/sde. The version is a hash of the file, so
 * a new build of it gets a new address in the browser's cache.
 */
export function loadKspaceSource(dataDir: string): JumpSpaceSource {
  const custom = join(dataDir, 'kspace.json');
  const file = existsSync(custom) ? custom : KSPACE_DATA_FILE;
  const text = readFileSync(file, 'utf8');
  const data = JSON.parse(text) as KspaceData;
  return { version: createHash('sha256').update(text).digest('hex').slice(0, 16), data };
}
