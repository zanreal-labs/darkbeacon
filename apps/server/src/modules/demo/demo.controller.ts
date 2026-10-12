import { Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { AccountService, SESSION_TTL_MS } from '@darkbeacon/identity';
import { nestPath, routes, type MeDto } from '@darkbeacon/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../../config/config.js';
import { SignInCookies } from '../../platform/sign-in-cookies.js';
import { APP_CONFIG } from '../../platform/tokens.js';
import { clearCookie, DEMO_OPT_OUT_COOKIE, serializeCookie, SESSION_COOKIE } from '../identity/cookies.js';
import { DemoService } from './demo.service.js';

@Controller()
export class DemoController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DemoService) private readonly demo: DemoService,
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(SignInCookies) private readonly signInCookies: SignInCookies,
  ) {}

  /**
   * Demo mode only (404 otherwise): signs in as the demo account. The web app's proxy calls it for a
   * signed-out page visit, so the first HTML is already the signed-in app.
   */
  @Post(nestPath(routes.auth.demo.path))
  @HttpCode(200)
  async signIn(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MeDto> {
    const signedIn = await this.demo.signIn(request.headers['user-agent'] ?? null);
    const secure = this.config.publicUrl.startsWith('https://');
    reply.header('set-cookie', [
      serializeCookie(SESSION_COOKIE, signedIn.token, { maxAgeSeconds: SESSION_TTL_MS / 1000, secure }),
      clearCookie(DEMO_OPT_OUT_COOKIE, { secure }),
      ...(await this.signInCookies.for(signedIn.account.id, request, secure)),
    ]);
    return this.accounts.me(await this.accounts.actorFor(signedIn.account));
  }
}
