import { Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { AccountService, SESSION_TTL_MS } from '@wormwright/identity';
import { nestPath, routes, type MeDto } from '@wormwright/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG } from '../../platform/tokens.js';
import { serializeCookie, SESSION_COOKIE } from '../identity/cookies.js';
import { DemoService } from './demo.service.js';

@Controller()
export class DemoController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DemoService) private readonly demo: DemoService,
    @Inject(AccountService) private readonly accounts: AccountService,
  ) {}

  /** Demo mode only (404 otherwise): signs in as the demo account; the web app calls it by itself. */
  @Post(nestPath(routes.auth.demo.path))
  @HttpCode(200)
  async signIn(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MeDto> {
    const signedIn = await this.demo.signIn(request.headers['user-agent'] ?? null);
    reply.header(
      'set-cookie',
      serializeCookie(SESSION_COOKIE, signedIn.token, {
        maxAgeSeconds: SESSION_TTL_MS / 1000,
        secure: this.config.publicUrl.startsWith('https://'),
      }),
    );
    return this.accounts.me(await this.accounts.actorFor(signedIn.account));
  }
}
