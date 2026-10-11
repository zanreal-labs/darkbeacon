import { readFileSync } from 'node:fs';
import { Controller, Get, Inject } from '@nestjs/common';
import { Database } from '@wormwright/db';
import { nestPath, routes, type HealthDto } from '@wormwright/shared';

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

@Controller()
export class HealthController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get(nestPath(routes.health.path))
  async health(): Promise<HealthDto> {
    await this.database.ping();
    return { status: 'ok', version, database: this.database.dialect };
  }
}
