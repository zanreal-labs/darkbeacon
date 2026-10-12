import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { Duplex } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/** Where the web app's server (Next.js) answers, e.g. `http://127.0.0.1:41234`. */
export interface WebUpstream {
  readonly origin: string;
}

/** OAuth metadata documents served by Nest (RFC 8414, RFC 9728). */
export const WELL_KNOWN_PATHS = [
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration',
];

/** `/api` and everything below it belongs to Nest, and so do the MCP endpoint and the OAuth metadata. */
export function isApiPath(url: string): boolean {
  const path = url.split('?')[0]!;
  return path === '/api' || path.startsWith('/api/') || path === '/mcp' || WELL_KNOWN_PATHS.includes(path);
}

/** The realtime socket, handled by the Nest gateway. */
export function isRealtimePath(url: string): boolean {
  return url === '/ws' || url.startsWith('/ws?');
}

/** Headers that describe one connection and must not be passed on (RFC 9110 7.6.1). */
const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'upgrade',
];

function forwardedHeaders(req: IncomingMessage, keepUpgrade: boolean): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = { ...req.headers };
  for (const name of HOP_BY_HOP)
    if (!(keepUpgrade && (name === 'upgrade' || name === 'connection'))) delete headers[name];
  const address = req.socket.remoteAddress;
  const prior = req.headers['x-forwarded-for'];
  if (address) headers['x-forwarded-for'] = prior ? `${String(prior)}, ${address}` : address;
  // The host is the one this request was sent to: a client-supplied x-forwarded-host could name
  // any site. A reverse proxy in front keeps the visitor's Host (as Caddy does, or nginx with
  // `proxy_set_header Host $host`). The scheme a TLS-terminating proxy reports is kept, but only
  // as http or https: it cannot point anywhere else.
  if (req.headers.host) headers['x-forwarded-host'] = req.headers.host;
  else delete headers['x-forwarded-host'];
  const proto = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    ?.trim()
    .toLowerCase();
  headers['x-forwarded-proto'] =
    proto === 'https' || proto === 'http'
      ? proto
      : (req.socket as { encrypted?: boolean }).encrypted
        ? 'https'
        : 'http';
  return headers;
}

/** Shown while the web server is (re)starting, instead of a blank page or a bare 502. */
const UNAVAILABLE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="2"><meta name="color-scheme" content="light dark"><title>Darkbeacon</title><style>body{font:14px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}p{opacity:.7}</style></head><body><main><h1>Darkbeacon is starting</h1><p>This page reloads by itself in a moment.</p></main></body></html>`;

/**
 * Forwards one HTTP request to the web server and streams the answer back as it comes, so
 * streamed (Suspense) HTML reaches the browser chunk by chunk.
 */
export function forwardRequest(
  req: IncomingMessage,
  res: ServerResponse,
  upstream: WebUpstream,
  onError: (error: Error) => void = () => {},
): void {
  const target = new URL(upstream.origin);
  const outgoing = httpRequest(
    {
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: req.url,
      headers: forwardedHeaders(req, false),
    },
    (answer) => {
      const headers = { ...answer.headers };
      for (const name of HOP_BY_HOP) delete headers[name];
      res.writeHead(answer.statusCode ?? 502, answer.statusMessage, headers);
      // Push every chunk out at once: the shell must not wait for the streamed parts.
      res.flushHeaders();
      answer.pipe(res);
      answer.on('error', () => res.destroy());
    },
  );
  outgoing.on('error', (error) => {
    onError(error);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(503, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': '2',
    });
    res.end(UNAVAILABLE_PAGE);
  });
  res.on('close', () => {
    if (!res.writableFinished) outgoing.destroy();
  });
  req.pipe(outgoing);
}

/** Forwards a WebSocket upgrade (the dev server's hot reload) to the web server. */
export function forwardUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  upstream: WebUpstream,
): void {
  const target = new URL(upstream.origin);
  const outgoing = httpRequest({
    hostname: target.hostname,
    port: target.port,
    method: req.method,
    path: req.url,
    headers: forwardedHeaders(req, true),
  });
  socket.on('error', () => outgoing.destroy());
  outgoing.on('error', () => socket.destroy());
  outgoing.on('response', (answer) => {
    // Refused upgrade: pass the status on and close.
    socket.end(`HTTP/1.1 ${answer.statusCode} ${answer.statusMessage}\r\nconnection: close\r\n\r\n`);
    answer.resume();
  });
  outgoing.on('upgrade', (answer, upstreamSocket, upstreamHead) => {
    const lines = [`HTTP/1.1 101 ${answer.statusMessage ?? 'Switching Protocols'}`];
    for (let i = 0; i < answer.rawHeaders.length; i += 2)
      lines.push(`${answer.rawHeaders[i]}: ${answer.rawHeaders[i + 1]}`);
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (upstreamHead.length > 0) socket.write(upstreamHead);
    upstreamSocket.on('error', () => socket.destroy());
    upstreamSocket.pipe(socket).pipe(upstreamSocket);
  });
  if (head.length > 0) outgoing.write(head);
  outgoing.end();
}

/**
 * Makes Nest the one front door: `/api` stays with Nest, `/ws` with the realtime gateway, and
 * everything else (pages, their assets, streamed HTML and the dev server's hot reload) goes to
 * the web server. Without an upstream only the API is served.
 *
 * Call before `app.init()`; `installUpgradeRouting` runs after it, once the gateway listens.
 */
export function installWebProxy(
  app: NestFastifyApplication,
  upstream: WebUpstream | null,
  onError?: (error: Error) => void,
): void {
  if (!upstream) return;
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, reply, done) => {
      if (isApiPath(request.url)) return done();
      // The request body is not parsed: it is streamed to the web server untouched.
      void reply.hijack();
      forwardRequest(request.raw, reply.raw, upstream, onError);
    });
}

/**
 * The gateway's upgrade listener closes every socket that is not `/ws`; this puts a router in
 * front of it so other upgrades reach the web server.
 */
export function installUpgradeRouting(server: Server, upstream: WebUpstream | null): void {
  if (!upstream) return;
  const gateway = server.listeners('upgrade') as ((
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => void)[];
  server.removeAllListeners('upgrade');
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (isRealtimePath(req.url ?? '/'))
      for (const listener of gateway) listener.call(server, req, socket, head);
    else forwardUpgrade(req, socket, head, upstream);
  });
}
