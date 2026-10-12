import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { WebUpstream } from './web-proxy.js';

/** The Next.js standalone server, seen from apps/server/(src|dist)/web/. */
export const WEB_SERVER_ENTRY = fileURLToPath(
  new URL('../../../web/.next/standalone/apps/web/server.js', import.meta.url),
);

export interface WebServerLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface WebServer extends WebUpstream {
  /** Stops the process (SIGTERM, then SIGKILL after `graceMs`) and does not restart it. */
  stop(): Promise<void>;
}

/** A free TCP port on the loopback interface, chosen by the OS. */
export function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() =>
        address && typeof address === 'object' ? resolve(address.port) : reject(new Error('no port')),
      );
    });
  });
}

export interface StartWebServerOptions {
  entry: string;
  /** Where the web server reaches the API (session cookies are forwarded to it). */
  apiOrigin: string;
  logger: WebServerLogger;
  env?: NodeJS.ProcessEnv;
  graceMs?: number;
}

/**
 * Runs the web app's server as a child process on a loopback port nobody outside the container
 * sees, and keeps it running: an unexpected exit restarts it after 1 s, doubling up to 30 s
 * (the delay resets once it stayed up for a minute).
 */
export async function startWebServer(options: StartWebServerOptions): Promise<WebServer> {
  const port = await freeLoopbackPort();
  const origin = `http://127.0.0.1:${port}`;
  const graceMs = options.graceMs ?? 10_000;
  let child: ChildProcess | null = null;
  let stopped = false;
  let delay = 1_000;
  let timer: NodeJS.Timeout | undefined;

  const pipe = (stream: NodeJS.ReadableStream | null, write: (line: string) => void) => {
    let buffered = '';
    stream?.setEncoding('utf8');
    stream?.on('data', (chunk: string) => {
      buffered += chunk;
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) write(line);
    });
  };

  const run = () => {
    const startedAt = Date.now();
    const proc = spawn(process.execPath, [options.entry], {
      env: {
        ...process.env,
        ...options.env,
        NODE_ENV: 'production',
        PORT: String(port),
        HOSTNAME: '127.0.0.1',
        INTERNAL_API_URL: options.apiOrigin,
        NEXT_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child = proc;
    pipe(proc.stdout, (line) => options.logger.log(line));
    pipe(proc.stderr, (line) => options.logger.warn(line));
    proc.once('exit', (code, signal) => {
      child = null;
      if (stopped) return;
      if (Date.now() - startedAt > 60_000) delay = 1_000;
      options.logger.error(
        `web server exited (${signal ?? `code ${code}`}); restarting in ${Math.round(delay / 1000)} s`,
      );
      timer = setTimeout(run, delay);
      delay = Math.min(delay * 2, 30_000);
    });
  };
  run();

  return {
    origin,
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      const proc = child;
      if (!proc) return;
      await new Promise<void>((resolve) => {
        const kill = setTimeout(() => proc.kill('SIGKILL'), graceMs);
        proc.once('exit', () => {
          clearTimeout(kill);
          resolve();
        });
        proc.kill('SIGTERM');
      });
    },
  };
}

/**
 * How this process gets its web app:
 * - `WEB_UPSTREAM` set (development): proxy to that server, which someone else runs (`next dev`);
 * - a built standalone server present: start it on a free loopback port;
 * - neither: serve the API only.
 */
export async function resolveWebServer(
  env: NodeJS.ProcessEnv,
  apiOrigin: string,
  logger: WebServerLogger,
  /** Extra environment for the web server (its telemetry settings). */
  webEnv: NodeJS.ProcessEnv = {},
): Promise<WebServer | null> {
  if (env.WEB_UPSTREAM) return { origin: env.WEB_UPSTREAM.replace(/\/+$/, ''), stop: async () => {} };
  const entry = env.WEB_SERVER_ENTRY ?? WEB_SERVER_ENTRY;
  if (!existsSync(entry)) {
    logger.warn(`no web app build at ${entry}; serving the API only`);
    return null;
  }
  return startWebServer({ entry, apiOrigin, logger, env: webEnv });
}

/** Asks the web server's own health route; false when it does not answer within `timeoutMs`. */
export async function webServerAnswers(upstream: WebUpstream, timeoutMs = 2_000): Promise<boolean> {
  try {
    const response = await fetch(`${upstream.origin}/healthz`, { signal: AbortSignal.timeout(timeoutMs) });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}
