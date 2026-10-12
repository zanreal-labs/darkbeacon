import { Injectable, Logger } from '@nestjs/common';
import type { RequestLike } from './actor.js';

/**
 * Adds cookies to the answer that starts a session. Gets the signed-in account, the request and
 * whether cookies must be `Secure`; returns serialized `Set-Cookie` values.
 */
export type SignInCookieSource = (
  accountId: string,
  request: RequestLike,
  secure: boolean,
) => Promise<string[]>;

/**
 * Extension point for sign-in: modules add cookies a new session should come with (the themes
 * module adds the account's theme, so a new browser paints it before any script asks for it).
 * Identity calls it wherever it starts a session; a failing source is logged and skipped.
 */
@Injectable()
export class SignInCookies {
  private readonly logger = new Logger('SignInCookies');
  private readonly sources: SignInCookieSource[] = [];

  use(source: SignInCookieSource): void {
    this.sources.push(source);
  }

  async for(accountId: string, request: RequestLike, secure: boolean): Promise<string[]> {
    const all = await Promise.all(
      this.sources.map((source) =>
        source(accountId, request, secure).catch((error: unknown) => {
          this.logger.warn(`a sign-in cookie was skipped: ${String(error)}`);
          return [];
        }),
      ),
    );
    return all.flat();
  }
}
