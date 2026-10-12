import { readFileSync } from 'node:fs';

/** The server's version (apps/server/package.json), shown in health and written into backups. */
export const APP_VERSION = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
).version;
