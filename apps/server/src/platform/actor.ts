import {
  createParamDecorator,
  HttpException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ForbiddenError, grantOf, UnauthenticatedError, type Actor } from '@darkbeacon/core';
import { describeRequirement, scopesAllow, type ScopeRequirement } from '@darkbeacon/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/config.js';
import { clientAddress } from './client-address.js';
import { LIMITS, RateLimiter } from './rate-limiter.js';
import { routeFor } from './route-index.js';
import { APP_CONFIG } from './tokens.js';

export interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  /** The client's address as `clientAddress` reads it, when known. */
  ip?: string | null;
  /** Path of the request (`/mcp`, `/api/...`), when known. */
  url?: string;
}

/** Turns request headers (session cookie) into an Actor; null = anonymous. */
export type ActorResolver = (request: RequestLike) => Promise<Actor | null>;

/** What a bearer token resolved to. */
export interface BearerResolution {
  actor: Actor;
  credentialId: string;
  /** Requests a minute for this credential; null: the default. */
  rateLimitPerMinute: number | null;
}

/** Verifies a bearer token; throws `UnauthenticatedError` for anything that is not a valid one. */
export type BearerResolver = (token: string, request: RequestLike) => Promise<BearerResolution>;

/** The MCP endpoint, outside `/api`. */
export function isMcpPath(url: string | undefined): boolean {
  return url === '/mcp' || !!url?.startsWith('/mcp?');
}

/** `Authorization: Bearer <token>`, or null. */
export function bearerToken(request: RequestLike): string | null {
  const raw = request.headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const match = value ? /^Bearer\s+(\S+)\s*$/i.exec(value) : null;
  return match ? match[1]! : null;
}

/**
 * Extension point for authentication, used by HTTP, WebSocket and MCP. The identity module
 * installs the session resolver, the api-keys module the bearer resolver, in `onModuleInit`;
 * until then everyone is anonymous and every bearer token is refused.
 */
@Injectable()
export class ActorResolverRegistry {
  private resolver: ActorResolver = () => Promise.resolve(null);
  private bearer: BearerResolver | null = null;

  use(resolver: ActorResolver): void {
    this.resolver = resolver;
  }

  useBearer(resolver: BearerResolver): void {
    this.bearer = resolver;
  }

  /** The session behind the cookies (ignores any bearer token). */
  session(request: RequestLike): Promise<Actor | null> {
    return this.resolver(request);
  }

  /** Verifies a bearer token (throws when it is not valid). */
  verifyBearer(token: string, request: RequestLike): Promise<BearerResolution> {
    if (!this.bearer)
      return Promise.reject(new UnauthenticatedError('API keys are not enabled on this server'));
    return this.bearer(token, request);
  }

  /**
   * The actor of a request: the bearer token when there is one (an invalid token is anonymous
   * here; HTTP answers it with 401 in the guard), else the session cookie.
   */
  async resolve(request: RequestLike): Promise<Actor | null> {
    const token = bearerToken(request);
    if (token)
      return this.verifyBearer(token, request).then(
        (r) => r.actor,
        () => null,
      );
    return this.session(request);
  }
}

type GuardedRequest = FastifyRequest & { actor?: Actor | null; clientIp?: string | null };

/** True when a browser sent the request from this instance's own pages (or a client sent no Origin). */
export function sameOrigin(headers: RequestLike['headers'], publicOrigin: string): boolean {
  const origin = headers.origin;
  if (origin === undefined) return true;
  const value = Array.isArray(origin) ? origin[0] : origin;
  if (value === publicOrigin) return true;
  try {
    return new URL(value!).host === headers.host;
  } catch {
    return false;
  }
}

class TooManyRequests extends HttpException {
  constructor(message: string) {
    super(message, 429);
  }
}

/**
 * Global guard: resolves the actor once per HTTP request and enforces what a credential may do.
 *
 * - `Authorization: Bearer <key>`: the key alone decides (cookies are ignored); an invalid key is a
 *   401 with a `WWW-Authenticate` challenge, a key without the route's scope a 403
 *   (`insufficient_scope`), routes outside the contract are refused to keys. Failed tokens are
 *   counted per address and an address with too many is refused for a while (429).
 * - Cookies count only for same-origin requests: a page on another origin never acts with the
 *   visitor's session, even where CORS lets it read answers (Bearer only).
 * Use cases still authorize every call; this only narrows.
 */
@Injectable()
export class ActorGuard implements CanActivate {
  private readonly publicOrigin: string;

  constructor(
    @Inject(ActorResolverRegistry) private readonly actors: ActorResolverRegistry,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.publicOrigin = new URL(config.publicUrl).origin;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const ip = clientAddress(request.raw.socket.remoteAddress, request.headers['x-forwarded-for']);
    request.clientIp = ip;
    const like: RequestLike = { headers: request.headers, ip, url: request.url };
    const token = bearerToken(like);

    if (!token) {
      request.actor = sameOrigin(request.headers, this.publicOrigin) ? await this.actors.session(like) : null;
      return true;
    }

    const failures = `auth-failures:${ip ?? 'unknown'}`;
    if (this.limiter.exhausted(failures, LIMITS.authFailures)) {
      reply.header('retry-after', '60');
      throw new TooManyRequests('Too many invalid API keys from this address; try again later');
    }
    let resolved: BearerResolution;
    try {
      resolved = await this.actors.verifyBearer(token, like);
    } catch (error) {
      this.limiter.take(failures, LIMITS.authFailures);
      const message = error instanceof Error ? error.message : 'Invalid API key';
      reply.header('www-authenticate', challenge('invalid_token', message));
      throw error instanceof UnauthenticatedError ? error : new UnauthenticatedError('Invalid API key');
    }
    const limit = this.limiter.take(
      `key:${resolved.credentialId}`,
      resolved.rateLimitPerMinute ?? LIMITS.keyDefault,
    );
    if (!limit.ok) {
      reply.header('retry-after', String(limit.retryAfterSeconds));
      throw new TooManyRequests('This API key is over its rate limit');
    }
    // The MCP endpoint checks each tool's scope itself.
    if (!isMcpPath(request.url)) this.authorizeRoute(request, reply, resolved.actor);
    request.actor = resolved.actor;
    return true;
  }

  /** A key may call a contract route its scopes cover, and nothing else. */
  private authorizeRoute(request: GuardedRequest, reply: FastifyReply, actor: Actor): void {
    const grant = grantOf(actor);
    if (!grant) return;
    const route = routeFor(request.method, request.routeOptions.url);
    if (route?.deprecated) reply.header('deprecation', 'true');
    const requirement: ScopeRequirement = route?.scope ?? 'session';
    if (grant.readOnly && request.method !== 'GET' && requirement !== 'none') {
      reply.header('www-authenticate', challenge('insufficient_scope', 'This API key is read-only'));
      throw new ForbiddenError('This API key is read-only');
    }
    const params = (request.params ?? {}) as Record<string, string | undefined>;
    const stream = params.stream?.startsWith('map:') ? params.stream.slice(4) : null;
    const mapId = params.mapId ?? stream ?? null;
    if (!scopesAllow(grant.scopes, requirement, mapId, grant.readOnly)) {
      const needed = typeof requirement === 'object' ? `${requirement.resource}:${requirement.action}` : null;
      const message =
        requirement === 'session'
          ? 'API keys cannot call this route; it needs a browser session'
          : `This API key lacks the scope ${describeRequirement(requirement)}`;
      reply.header('www-authenticate', challenge('insufficient_scope', message, needed));
      throw new ForbiddenError(message, needed ? { requiredScope: needed } : undefined);
    }
  }
}

/** A Bearer challenge (RFC 6750 section 3). */
export function challenge(error: string, description: string, scope?: string | null): string {
  // Header values are visible ASCII; quotes and backslashes would end the parameter.
  const quote = (s: string) => s.replace(/\u2026/g, '...').replace(/[^\x20-\x7e]|["\\]/g, '');
  return `Bearer realm="darkbeacon", error="${error}", error_description="${quote(description)}"${
    scope ? `, scope="${quote(scope)}"` : ''
  }`;
}

/** `@CurrentActor() actor: Actor | null` in a controller method. */
export const CurrentActor = createParamDecorator(
  (_: unknown, context: ExecutionContext): Actor | null =>
    context.switchToHttp().getRequest<GuardedRequest>().actor ?? null,
);

/** `@ClientIp() ip: string | null`: the client address as the guard read it. */
export const ClientIp = createParamDecorator(
  (_: unknown, context: ExecutionContext): string | null =>
    context.switchToHttp().getRequest<GuardedRequest>().clientIp ?? null,
);
