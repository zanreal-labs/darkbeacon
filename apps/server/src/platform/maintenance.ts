import { Injectable, Logger } from '@nestjs/common';
import { ConflictError } from '@darkbeacon/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { isApiPath } from '../web/web-proxy.js';

/** Something that keeps database state in memory or works in the background. */
export interface MaintenanceParticipant {
  name: string;
  /** Stop touching the database (stop timers, finish what runs). */
  pause?(): Promise<void> | void;
  /** Start again; with `restored` the database was replaced, so reload what is kept in memory. */
  resume?(restored: boolean): Promise<void> | void;
}

const DRAIN_MS = 10_000;

/**
 * Maintenance mode, used while the database is replaced (a restore). Writes over HTTP are
 * refused with 503, page loads get a "back in a moment" page, new WebSockets are turned away,
 * and participants (event consumers, plugins, pollers...) pause. Modules register participants
 * in `onModuleInit`; nothing here knows who uses it.
 */
@Injectable()
export class MaintenanceMode {
  private state: { reason: string; since: number } | null = null;
  private readonly participants: MaintenanceParticipant[] = [];
  private inflight = 0;
  private idle: Array<() => void> = [];
  private readonly logger = new Logger('Maintenance');

  get active(): { reason: string; since: number } | null {
    return this.state;
  }

  /** Returns a function that removes the participant again. */
  register(participant: MaintenanceParticipant): () => void {
    this.participants.push(participant);
    return () => {
      const index = this.participants.indexOf(participant);
      if (index !== -1) this.participants.splice(index, 1);
    };
  }

  async enter(reason: string, drainMs = DRAIN_MS): Promise<void> {
    if (this.state) throw new ConflictError(`Maintenance is already on (${this.state.reason})`);
    this.state = { reason, since: Date.now() };
    this.logger.warn(`maintenance on: ${reason}`);
    await this.drain(drainMs);
    for (const participant of this.participants) {
      try {
        await participant.pause?.();
      } catch (error) {
        this.logger.error(`${participant.name} did not pause: ${message(error)}`);
      }
    }
  }

  async leave(restored: boolean): Promise<void> {
    if (!this.state) return;
    this.state = null;
    for (const participant of [...this.participants].reverse()) {
      try {
        await participant.resume?.(restored);
      } catch (error) {
        this.logger.error(`${participant.name} did not resume: ${message(error)}`);
      }
    }
    this.logger.log(restored ? 'maintenance off: database restored' : 'maintenance off');
  }

  requestStarted(): void {
    this.inflight++;
  }

  requestEnded(): void {
    this.inflight = Math.max(0, this.inflight - 1);
    if (this.inflight === 0) for (const resolve of this.idle.splice(0)) resolve();
  }

  /** Waits for HTTP requests in flight (at most `ms`; after that the database lock still orders them). */
  private drain(ms: number): Promise<void> {
    if (this.inflight === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.logger.warn(`${this.inflight} request(s) still running after ${ms} ms; going ahead`);
        resolve();
      }, ms);
      this.idle.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

/** Requests that keep working in maintenance: health checks and the backup routes themselves. */
function exempt(url: string): boolean {
  return url.startsWith('/api/health') || url.startsWith('/api/admin/backups');
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="3"><title>Back in a moment · Darkbeacon</title>
<style>
:root{color-scheme:light dark;--bg:#f6f7f9;--fg:#14171c;--muted:#5b6472}
@media (prefers-color-scheme:dark){:root{--bg:#0d1014;--fg:#e8ebf0;--muted:#98a2b3}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);
font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px;box-sizing:border-box}
main{max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{margin:0;color:var(--muted)}
</style></head><body><main><h1>Back in a moment</h1>
<p>An admin is restoring a backup of this Darkbeacon. The page reloads by itself when it is done.</p>
</main></body></html>`;

/**
 * The HTTP side of maintenance mode. Install it before the web proxy, so page loads are answered
 * here instead of being forwarded. Requests in flight are counted (backup routes excepted) so a
 * restore can wait for them.
 */
export function installMaintenanceGate(app: NestFastifyApplication, maintenance: MaintenanceMode): void {
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, reply, done) => {
      const url = request.url;
      const api = isApiPath(url);
      if (api && !exempt(url)) {
        maintenance.requestStarted();
        reply.raw.once('close', () => maintenance.requestEnded());
      }
      if (!maintenance.active) return done();
      const reading = request.method === 'GET' || request.method === 'HEAD';
      if (api) {
        if (reading || exempt(url)) return done();
        void reply
          .status(503)
          .header('retry-after', '5')
          .send({
            error: {
              code: 'unavailable',
              message: 'Darkbeacon is restoring a backup. Try again in a moment.',
              details: { maintenance: true },
            },
          });
        return;
      }
      const accept = String(request.headers.accept ?? '');
      if (reading && (request.headers['sec-fetch-dest'] === 'document' || accept.includes('text/html'))) {
        void reply
          .status(503)
          .header('retry-after', '5')
          .header('cache-control', 'no-store')
          .type('text/html; charset=utf-8')
          .send(PAGE);
        return;
      }
      done();
    });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
