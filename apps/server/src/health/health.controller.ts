import { readFileSync } from 'node:fs';
import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Database } from '@darkbeacon/db';
import { nestPath, routes, type HealthDto, type ReadyDto } from '@darkbeacon/shared';
import { WEB_UPSTREAM } from '../platform/tokens.js';
import { webServerAnswers } from '../web/web-server.js';
import type { WebUpstream } from '../web/web-proxy.js';

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/** The id of the web build next to this server (Next.js writes it at build time); null in development. */
const WEB_BUILD = (() => {
  try {
    return (
      readFileSync(
        new URL('../../../web/.next/standalone/apps/web/.next/BUILD_ID', import.meta.url),
        'utf8',
      ).trim() || null
    );
  } catch {
    return null;
  }
})();

/**
 * `/api/health`: healthy when the database answers and, if this process fronts the web app, its
 * server does too. `/api/ready`: the database answers and every migration is applied.
 */
@Controller()
export class HealthController {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(WEB_UPSTREAM) private readonly web: WebUpstream | null,
  ) {}

  @Get(nestPath(routes.health.path))
  async health(): Promise<HealthDto> {
    await this.database.ping();
    if (this.web && !(await webServerAnswers(this.web))) {
      throw new ServiceUnavailableException('The web app server is not answering');
    }
    return {
      status: 'ok',
      version,
      database: this.database.dialect,
      web: this.web ? 'ok' : 'off',
      ...(WEB_BUILD ? { build: WEB_BUILD } : {}),
    };
  }

  /** Ready for traffic: the database answers and no migration is pending. */
  @Get(nestPath(routes.ready.path))
  async ready(): Promise<ReadyDto> {
    let migrations: ReadyDto['migrations'];
    try {
      await this.database.ping();
      const status = await this.database.migrationStatus();
      migrations = { applied: status.applied.length, pending: status.pending.length };
    } catch {
      throw new ServiceUnavailableException('The database is not answering');
    }
    if (migrations.pending > 0) {
      throw new ServiceUnavailableException(`${migrations.pending} database migrations are not applied yet`);
    }
    return { status: 'ready', database: this.database.dialect, migrations };
  }
}
