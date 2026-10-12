import { readFileSync } from 'node:fs';
import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Database } from '@darkbeacon/db';
import { nestPath, routes, type HealthDto } from '@darkbeacon/shared';
import { WEB_UPSTREAM } from '../platform/tokens.js';
import { webServerAnswers } from '../web/web-server.js';
import type { WebUpstream } from '../web/web-proxy.js';

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/** Healthy when the database answers and, if this process fronts the web app, its server does too. */
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
    return { status: 'ok', version, database: this.database.dialect, web: this.web ? 'ok' : 'off' };
  }
}
