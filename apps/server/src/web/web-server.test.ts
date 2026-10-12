import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveWebServer, startWebServer, webServerAnswers, type WebServer } from './web-server.js';

/** A tiny "web server": answers /healthz, tells what it was started with, crashes on /crash. */
const SCRIPT = `
const http = require('node:http');
http.createServer((req, res) => {
  if (req.url === '/crash') process.exit(3);
  if (req.url === '/healthz') return res.end('ok');
  res.end(JSON.stringify({ host: process.env.HOSTNAME, api: process.env.INTERNAL_API_URL, pid: process.pid }));
}).listen(Number(process.env.PORT), process.env.HOSTNAME, () => console.log('ready'));
`;

function entry(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dbk-web-'));
  const file = join(dir, 'server.cjs');
  writeFileSync(file, SCRIPT);
  return file;
}

const logger = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('web server process', () => {
  let server: WebServer | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  it('runs on a loopback port, knows the API and restarts after a crash', async () => {
    const log = logger();
    server = await startWebServer({ entry: entry(), apiOrigin: 'http://127.0.0.1:3000', logger: log });
    expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await vi.waitFor(() => expect(log.log).toHaveBeenCalledWith('ready'), { timeout: 5_000 });
    const first = (await (await fetch(server.origin)).json()) as { host: string; api: string; pid: number };
    expect(first).toMatchObject({ host: '127.0.0.1', api: 'http://127.0.0.1:3000' });

    await fetch(`${server.origin}/crash`).catch(() => undefined);
    await vi.waitFor(() => expect(log.error).toHaveBeenCalledWith(expect.stringContaining('restarting')));
    await vi.waitFor(async () => expect(await webServerAnswers(server!)).toBe(true), { timeout: 5_000 });
    const second = (await (await fetch(server.origin)).json()) as { pid: number };
    expect(second.pid).not.toBe(first.pid);

    await server.stop();
    expect(await webServerAnswers(server, 500)).toBe(false);
  });

  it('uses WEB_UPSTREAM as is, and serves the API only without a build', async () => {
    const log = logger();
    const upstream = await resolveWebServer({ WEB_UPSTREAM: 'http://127.0.0.1:3001/' }, 'x', log);
    expect(upstream?.origin).toBe('http://127.0.0.1:3001');
    expect(await resolveWebServer({ WEB_SERVER_ENTRY: '/nonexistent/server.js' }, 'x', log)).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('serving the API only'));
  });
});
