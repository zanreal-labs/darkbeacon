import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { c as createTar } from 'tar';

export function tempDir(prefix = 'dbk-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Writes files (objects become JSON) under `dir`. */
export function writeFiles(dir: string, files: Record<string, string | object>): string {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

/** A .tgz of `dir`, wrapped in `package/` like the tarballs npm produces. */
export async function packTgz(dir: string, prefix = 'package/'): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of createTar({ gzip: true, cwd: dir, prefix, portable: true }, ['.'])) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

export function pluginManifest(id: string, extra: Record<string, unknown> = {}) {
  return { id, name: `Plugin ${id}`, version: '1.0.0', sdk: '^1.0', server: 'server.js', ...extra };
}

/**
 * Server code of the test plugin. It reports into `globalThis.__dbkPlugins[<id>]` so tests can
 * see what the plugin received; `marker` tells two versions apart.
 */
export function fixtureServer(marker = 1): string {
  return `
const seen = (globalThis.__dbkPlugins ??= {});
let id;
export default {
  async register(ctx) {
    id = ctx.plugin.id;
    const log = (seen[id] ??= { events: [], notified: [], registered: 0, disposed: 0 });
    log.registered += 1;
    log.marker = ${marker};
    log.ports = Object.keys(ctx.ports).sort();
    log.version = ctx.plugin.version;
    if (log.subscribeTo) ctx.on(log.subscribeTo, () => {});
    if (log.failRegister) throw new Error('cannot start');
    log.publicUrl = ctx.instance.publicUrl;
    if (log.durable) {
      log.sealed = ctx.secrets.open(ctx.secrets.seal('secret')) === 'secret';
      ctx.consume({ name: 'durable', events: ['system.*'], handle: async (event) => {
        log.durable.push(event.type + '@' + event.stream);
      } });
    }
    ctx.on('system.*', async (event) => {
      if (event.data && event.data.fail) throw new Error('handler broke');
      log.events.push(event.type + '@' + event.stream);
    });
    ctx.http.route({ method: 'GET', path: '/hello/:name', handler: (r) => ({ body: { hello: r.params.name, account: r.accountId, q: r.query.q } }) });
    ctx.http.route({ method: 'GET', path: '/maps/:mapId', handler: (r) => ({ body: { role: r.mapRole } }) });
    ctx.http.route({ method: 'POST', path: '/boom', handler: () => { throw new Error('route broke'); } });
    ctx.provide('notifier', { id: 'memo', send: async (n) => { log.notified.push(n.title); } });
    if (ctx.ports.db) {
      const db = ctx.ports.db.db();
      await db.insertInto('fx_items').values({ name: 'run' }).execute();
      log.rows = (await db.selectFrom('fx_items').selectAll().execute()).length;
    }
    if (ctx.ports.events) log.instance = (await ctx.ports.events.readSince('instance', 0)).length;
  },
  dispose() {
    seen[id].disposed += 1;
  },
};
`;
}

export const fixtureMigration = `
export async function up(db) {
  await db.schema.createTable('fx_items').addColumn('name', 'text').execute();
}
`;

export interface FixtureLog {
  events: string[];
  notified: string[];
  registered: number;
  disposed: number;
  marker: number;
  ports: string[];
  version: string;
  rows?: number;
  instance?: number;
  subscribeTo?: string;
  failRegister?: boolean;
}

export function fixtureLogs(): Record<string, FixtureLog> {
  return ((globalThis as { __dbkPlugins?: Record<string, FixtureLog> }).__dbkPlugins ??= {});
}
