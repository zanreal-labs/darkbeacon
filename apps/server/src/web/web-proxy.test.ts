import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import WebSocket, { WebSocketServer } from 'ws';
import { createApp } from '../app.js';
import { parseEnv } from '../config/config.js';

/** A stand-in for the Next.js server: records what reached it and streams on request. */
function fakeWebServer() {
  const seen: { method: string; url: string; headers: IncomingHttpHeaders; body: string }[] = [];
  let release: () => void = () => {};
  const server: Server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      if (req.url === '/healthz') return res.end('ok');
      if (req.url === '/stream') {
        // The shell goes out first; the rest only once the test saw it arrive.
        res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'a=1; Path=/' });
        res.write('<main>shell</main>');
        release = () => res.end('<p>streamed</p>');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': ['a=1; Path=/', 'b=2; Path=/'] });
      res.end(`page ${req.url}`);
    });
  });
  const sockets = new WebSocketServer({ server, path: '/_next/webpack-hmr' });
  sockets.on('connection', (socket) => socket.on('message', (data) => socket.send(`echo ${String(data)}`)));
  return {
    seen,
    release: () => release(),
    listen: () =>
      new Promise<string>((resolve) =>
        server.listen(0, '127.0.0.1', () =>
          resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
        ),
      ),
    close: () =>
      new Promise<void>((resolve) => {
        sockets.close();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

describeEachDialect('web proxy', (t) => {
  let web: ReturnType<typeof fakeWebServer>;
  let app: NestFastifyApplication;
  let base: string;

  const start = async (origin: string) => {
    const config = { ...parseEnv({ NODE_ENV: 'test' }), secretKey: 'x'.repeat(32) };
    app = await createApp(config, { database: t.db, logger: false, web: { origin } });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  };

  beforeEach(async () => {
    web = fakeWebServer();
    await start(await web.listen());
  });

  afterEach(async () => {
    await app.close();
    await web.close();
  });

  it('keeps /api with Nest and sends every other path to the web server', async () => {
    const health = await fetch(`http://${base}/api/health`);
    expect(await health.json()).toMatchObject({ status: 'ok', web: 'ok' });
    const missing = await fetch(`http://${base}/api/nope`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: 'not_found' } });

    const page = await fetch(`http://${base}/m/home?tab=x`, { headers: { cookie: 'dbk_session=s' } });
    expect(await page.text()).toBe('page /m/home?tab=x');
    expect(page.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/']);
    const forwarded = web.seen.find((r) => r.url === '/m/home?tab=x')!;
    expect(forwarded.headers).toMatchObject({
      cookie: 'dbk_session=s',
      host: base,
      'x-forwarded-host': base,
      'x-forwarded-proto': 'http',
      'x-forwarded-for': '127.0.0.1',
    });
    expect(web.seen.some((r) => r.url.startsWith('/api'))).toBe(false);
  });

  it('does not pass on a host the client names in x-forwarded-host', async () => {
    await fetch(`http://${base}/admin`, {
      headers: { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' },
    });
    await fetch(`http://${base}/account`, { headers: { 'x-forwarded-proto': 'javascript' } });
    const admin = web.seen.find((r) => r.url === '/admin')!;
    // The scheme a TLS-terminating proxy reports is kept; the host is the one the request went to.
    expect(admin.headers).toMatchObject({
      host: base,
      'x-forwarded-host': base,
      'x-forwarded-proto': 'https',
    });
    expect(web.seen.find((r) => r.url === '/account')!.headers['x-forwarded-proto']).toBe('http');
  });

  it('passes request bodies through untouched', async () => {
    const body = JSON.stringify({ hello: 'world' });
    await fetch(`http://${base}/m/home`, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
    });
    expect(web.seen.find((r) => r.method === 'POST')).toMatchObject({ url: '/m/home', body });
  });

  it('streams the answer chunk by chunk', async () => {
    const response = await fetch(`http://${base}/stream`);
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    // The first chunk arrives while the web server still holds the rest back.
    expect((await reader.read()).value).toBe('<main>shell</main>');
    web.release();
    let rest = '';
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) rest += chunk.value;
    expect(rest).toBe('<p>streamed</p>');
  });

  it('forwards other WebSocket upgrades and keeps /ws for the realtime gateway', async () => {
    const hmr = new WebSocket(`ws://${base}/_next/webpack-hmr`);
    await new Promise((resolve, reject) => hmr.once('open', resolve).once('error', reject));
    hmr.send('ping');
    expect(String(await new Promise((resolve) => hmr.once('message', resolve)))).toBe('echo ping');
    hmr.close();

    const realtime = new WebSocket(`ws://${base}/ws`);
    await new Promise((resolve, reject) => realtime.once('open', resolve).once('error', reject));
    realtime.send(JSON.stringify({ op: 'subscribe', stream: 'instance' }));
    const answer = JSON.parse(String(await new Promise((resolve) => realtime.once('message', resolve))));
    expect(answer).toMatchObject({ op: 'error', code: 'unauthenticated' });
    realtime.close();
  });

  it('shows a starting page and fails health while the web server is down', async () => {
    await web.close();
    const page = await fetch(`http://${base}/`);
    expect(page.status).toBe(503);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('Darkbeacon is starting');
    const health = await fetch(`http://${base}/api/health`);
    expect(health.status).toBe(503);
    expect(await health.json()).toMatchObject({ error: { code: 'unavailable' } });
  });
});
