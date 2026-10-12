import {
  Body,
  Controller,
  Delete,
  Get,
  Global,
  HttpCode,
  HttpException,
  Inject,
  Logger,
  Module,
  Param,
  Post,
  Query,
  Res,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Actor, Clock, EventLog, MapAccess, UnitOfWork } from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import { AccountService } from '@darkbeacon/identity';
import type { MapRepository } from '@darkbeacon/mapping';
import { OAuthProtocolError, OAuthServer } from '@darkbeacon/oauth';
import {
  OAuthAuthorizeDecision,
  OAuthAuthorizeQuery,
  OAuthRegisterRequest,
  OAuthTokenRequest,
  TOKEN_PREFIX,
  nestPath,
  routes,
  type OAuthAuthorizeRequestDto,
  type OAuthGrantDto,
  type OAuthRedirectDto,
  type OAuthRegisteredClientDto,
  type OAuthTokenResponse,
} from '@darkbeacon/shared';
import type { FastifyReply } from 'fastify';
import {
  HmacOAuthSecrets,
  KyselyOAuthStore,
  httpsClientMetadata,
} from '../../adapters/oauth/kysely-oauth.js';
import type { AppConfig } from '../../config/config.js';
import { ActorResolverRegistry, ClientIp, CurrentActor, isMcpPath } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import { LIMITS, RateLimiter } from '../../platform/rate-limiter.js';
import { APP_CONFIG, CLOCK, EVENT_LOG, MAP_ACCESS, UNIT_OF_WORK } from '../../platform/tokens.js';
import { MappingModule } from '../mapping/mapping.module.js';
import { MAP_REPOSITORY } from '../mapping/mapping.tokens.js';

const r = routes.oauth;

/** OAuth answers errors as `{ error, error_description }`, not the API's error body (RFC 6749 5.2). */
async function oauth<T>(reply: FastifyReply, work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof OAuthProtocolError) {
      void reply
        .status(error.status)
        .header('cache-control', 'no-store')
        .send({ error: error.error, error_description: error.description });
      return undefined;
    }
    throw error;
  }
}

@Controller()
export class OAuthController {
  constructor(
    @Inject(OAuthServer) private readonly server: OAuthServer,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  private limit(ip: string | null, what: string): void {
    if (!this.limiter.take(`oauth-${what}:${ip ?? 'unknown'}`, 30).ok)
      throw new HttpException('Too many requests; slow down', 429);
  }

  @Post(nestPath(r.register.path))
  async register(
    @Body(new ZodPipe(OAuthRegisterRequest)) body: OAuthRegisterRequest,
    @ClientIp() ip: string | null,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OAuthRegisteredClientDto | undefined> {
    this.limit(ip, 'register');
    return oauth(reply, () => this.server.register(body));
  }

  @Post(nestPath(r.token.path))
  @HttpCode(200)
  async token(
    @Body(new ZodPipe(OAuthTokenRequest)) body: OAuthTokenRequest,
    @ClientIp() ip: string | null,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OAuthTokenResponse | undefined> {
    this.limit(ip, 'token');
    reply.header('cache-control', 'no-store');
    return oauth(reply, () => this.server.token(body));
  }

  @Get(nestPath(r.describe.path))
  describe(
    @CurrentActor() actor: Actor | null,
    @Query(new ZodPipe(OAuthAuthorizeQuery)) query: OAuthAuthorizeQuery,
  ): Promise<OAuthAuthorizeRequestDto> {
    return this.server.describe(actor, query);
  }

  @Post(nestPath(r.decide.path))
  @HttpCode(200)
  async decide(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(OAuthAuthorizeDecision)) body: OAuthAuthorizeDecision,
  ): Promise<OAuthRedirectDto> {
    return { redirectTo: await this.server.decide(actor, body) };
  }

  @Get(nestPath(r.grants.path))
  grants(@CurrentActor() actor: Actor | null): Promise<OAuthGrantDto[]> {
    return this.server.listGrants(actor);
  }

  @Delete(nestPath(r.revokeGrant.path))
  @HttpCode(204)
  async revoke(@CurrentActor() actor: Actor | null, @Param('grantId') grantId: string): Promise<void> {
    await this.server.revokeGrant(actor, grantId);
  }
}

/** The metadata documents, outside `/api` where clients look for them. */
@Controller('.well-known')
export class OAuthMetadataController {
  constructor(@Inject(OAuthServer) private readonly server: OAuthServer) {}

  /** RFC 9728: what protects `/mcp` and who issues tokens for it. */
  @Get(['oauth-protected-resource', 'oauth-protected-resource/mcp'])
  protectedResource(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('access-control-allow-origin', '*');
    return {
      resource: this.server.resource,
      authorization_servers: [this.server.issuer],
      bearer_methods_supported: ['header'],
      scopes_supported: SCOPES_SUPPORTED,
      resource_name: 'Darkbeacon',
      resource_documentation: `${this.server.issuer}/api/docs`,
    };
  }

  /** RFC 8414 (and OpenID discovery's location, which some clients try first). */
  @Get(['oauth-authorization-server', 'openid-configuration'])
  authorizationServer(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('access-control-allow-origin', '*');
    const issuer = this.server.issuer;
    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}${r.token.path}`,
      registration_endpoint: `${issuer}${r.register.path}`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      scopes_supported: SCOPES_SUPPORTED,
      service_documentation: `${issuer}/api/docs`,
    };
  }
}

/** The scopes an MCP client may ask for (admin scopes are never granted through OAuth). */
const SCOPES_SUPPORTED = [
  '*:read',
  'maps:read',
  'systems:read',
  'systems:write',
  'connections:read',
  'connections:write',
  'signatures:read',
  'signatures:write',
  'routes:read',
  'tracking:read',
  'audit:read',
  'account:read',
  'universe:read',
];

/**
 * OAuth 2.1 for the MCP endpoint: Darkbeacon is the authorization server of its own `/mcp`
 * (metadata, registration, consent with the existing sign-in, PKCE codes, rotating refresh
 * tokens). Access tokens act as the person who approved, narrowed by the approved scopes, and only
 * on `/mcp`. Without this module MCP clients use API keys.
 */
@Global()
@Module({
  imports: [MappingModule],
  controllers: [OAuthController, OAuthMetadataController],
  providers: [
    {
      provide: OAuthServer,
      useFactory: (
        db: Database,
        config: AppConfig,
        accounts: AccountService,
        maps: MapRepository,
        access: MapAccess,
        uow: UnitOfWork,
        events: EventLog,
        clock: Clock,
      ) =>
        new OAuthServer({
          store: new KyselyOAuthStore(db),
          secrets: new HmacOAuthSecrets(config.secretKey),
          metadata: httpsClientMetadata,
          accounts: {
            find: async (id) => {
              const account = await accounts.find(id);
              if (!account) return null;
              return {
                id: account.id,
                name: account.name,
                instanceRole: (await accounts.actorFor(account)).instanceRole,
              };
            },
          },
          maps: {
            describe: async (ids) =>
              (await maps.listByIds(ids)).map((m) => ({ id: m.id, name: m.name, slug: m.slug })),
          },
          access,
          uow,
          events,
          clock,
          publicUrl: config.publicUrl,
        }),
      inject: [
        Database,
        APP_CONFIG,
        AccountService,
        MAP_REPOSITORY,
        MAP_ACCESS,
        UNIT_OF_WORK,
        EVENT_LOG,
        CLOCK,
      ],
    },
  ],
  exports: [OAuthServer],
})
export class OAuthModule implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('OAuth');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(ActorResolverRegistry) private readonly actors: ActorResolverRegistry,
    @Inject(OAuthServer) private readonly server: OAuthServer,
  ) {}

  onModuleInit(): void {
    this.actors.useBearer([TOKEN_PREFIX.oauthAccess], async (token, request) => {
      const { actor, grantId } = await this.server.authenticate(token, {
        ip: request.ip ?? null,
        mcp: isMcpPath(request.url),
      });
      return { actor, credentialId: grantId, rateLimitPerMinute: LIMITS.keyDefault };
    });
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(
      () => {
        this.server.prune().catch((error: unknown) => this.logger.error(`pruning failed: ${String(error)}`));
      },
      60 * 60 * 1000,
    ).unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }
}
