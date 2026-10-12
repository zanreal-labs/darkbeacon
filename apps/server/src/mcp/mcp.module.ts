import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import {
  All,
  Controller,
  Inject,
  Logger,
  Module,
  Optional,
  Req,
  Res,
  type OnModuleDestroy,
} from '@nestjs/common';
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { InstanceSettingsService } from '@darkbeacon/access';
import { AuditTrail } from '@darkbeacon/audit';
import type { Actor } from '@darkbeacon/core';
import {
  ConnectionIntelQuery,
  ConnectionUseCases,
  MapUseCases,
  SignatureUseCases,
  SystemUseCases,
  type UniverseCatalog,
} from '@darkbeacon/mapping';
import { RouteQueries } from '@darkbeacon/routing';
import { OAuthServer } from '@darkbeacon/oauth';
import { MapPublishing } from '@darkbeacon/publishing';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/config.js';
import { LIMITS, RateLimiter } from '../platform/rate-limiter.js';
import { APP_CONFIG, UNIVERSE_CATALOG } from '../platform/tokens.js';
import { RealtimeHub } from '../realtime/realtime.hub.js';
import { AuditModule } from '../modules/audit/audit.module.js';
import { MappingModule } from '../modules/mapping/mapping.module.js';
import { MergedWriteRouter } from '../modules/mapping/merged-writes.js';
import { RoutingModule } from '../modules/routing/routing.module.js';
import { buildMcpServer, callerFor, type McpCaller, type McpDeps } from './tools.js';

/** The MCP specification revision this endpoint implements (and the 2025 revisions it still serves). */
export const MCP_SPEC_VERSION = '2026-07-28';

type McpRequest = FastifyRequest & { actor?: Actor | null; clientIp?: string | null };

/**
 * `/mcp`: the Model Context Protocol over Streamable HTTP (stateless, spec 2026-07-28; 2025-era
 * clients are served statelessly too by the SDK). A driving adapter: every tool calls a use case
 * as the caller. API keys authenticate with `Authorization: Bearer`; browser sessions never do.
 */
@Controller('mcp')
export class McpController implements OnModuleDestroy {
  private readonly logger = new Logger('Mcp');
  private readonly handler: McpHttpHandler;
  private readonly publicOrigin: string;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(InstanceSettingsService) private readonly settings: InstanceSettingsService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(MapUseCases) maps: MapUseCases,
    @Inject(SystemUseCases) systems: SystemUseCases,
    @Inject(ConnectionUseCases) connections: ConnectionUseCases,
    @Inject(SignatureUseCases) signatures: SignatureUseCases,
    @Inject(MergedWriteRouter) merged: MergedWriteRouter,
    @Inject(ConnectionIntelQuery) intel: ConnectionIntelQuery,
    @Inject(RouteQueries) routes: RouteQueries,
    @Inject(AuditTrail) audit: AuditTrail,
    @Inject(RealtimeHub) hub: RealtimeHub,
    @Inject(UNIVERSE_CATALOG) universe: UniverseCatalog,
    @Optional() @Inject(MapPublishing) publishing: MapPublishing | null,
    @Optional() @Inject(OAuthServer) private readonly oauth: OAuthServer | null,
  ) {
    this.publicOrigin = new URL(config.publicUrl).origin;
    const deps: McpDeps = {
      maps,
      systems,
      connections,
      signatures,
      merged,
      intel,
      routes,
      audit,
      hub,
      universe,
      publishing: publishing ?? null,
    };
    this.handler = createMcpHandler(
      (ctx) =>
        buildMcpServer(deps, (ctx.authInfo?.extra?.caller as McpCaller | undefined) ?? { kind: 'anonymous' }),
      {
        onerror: (error) => this.logger.error(error.stack ?? error.message),
        maxRequestBodySize: 256 * 1024,
      },
    );
  }

  @All()
  async handle(@Req() request: McpRequest, @Res() reply: FastifyReply): Promise<void> {
    const settings = await this.settings.current();
    const mode = settings.mcpMode ?? 'off';
    if (mode === 'off') {
      void reply
        .status(404)
        .send({ error: { code: 'not_found', message: 'The MCP endpoint is switched off on this instance' } });
      return;
    }
    // DNS rebinding and cross-site pages: a browser Origin must be this instance or an allowed one.
    const origin = request.headers.origin;
    if (origin && origin !== this.publicOrigin && !(settings.apiCorsOrigins ?? []).includes(origin)) {
      void reply.status(403).send({ jsonrpc: '2.0', error: { code: -32600, message: 'Origin not allowed' } });
      return;
    }
    const caller = callerFor(request.actor ?? null);
    if (caller.kind === 'anonymous') {
      if (mode !== 'public') {
        // RFC 9728 / MCP authorization: point OAuth clients at the protected resource metadata.
        const metadata = this.oauth
          ? `, resource_metadata="${this.config.publicUrl}/.well-known/oauth-protected-resource/mcp", scope="*:read"`
          : '';
        void reply
          .status(401)
          .header('www-authenticate', `Bearer realm="darkbeacon"${metadata}`)
          .send({ error: { code: 'unauthenticated', message: 'Sign in (OAuth) or use an API key' } });
        return;
      }
      const limit = this.limiter.take(`mcp-public:${request.clientIp ?? 'unknown'}`, LIMITS.publicReads);
      if (!limit.ok) {
        void reply
          .status(429)
          .header('retry-after', String(limit.retryAfterSeconds))
          .send({ error: { code: 'rate_limited', message: 'Too many requests; slow down' } });
        return;
      }
    }

    const url = new URL(request.url, this.config.publicUrl);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value === undefined || name === 'authorization' || name === 'cookie') continue;
      headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
    }
    const webRequest = new Request(url, { method: request.method, headers });
    const response = await this.handler.fetch(webRequest, {
      parsedBody: request.body,
      authInfo: {
        token: '',
        clientId: caller.kind === 'key' ? caller.grant.credentialId : 'anonymous',
        scopes: caller.kind === 'key' ? [...caller.grant.scopes] : [],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        extra: { caller },
      },
    });
    reply.status(response.status);
    response.headers.forEach((value, name) => void reply.header(name, value));
    if (!response.body) {
      void reply.send();
      return;
    }
    if ((response.headers.get('content-type') ?? '').includes('text/event-stream'))
      reply.header('x-accel-buffering', 'no');
    void reply.send(Readable.fromWeb(response.body as unknown as NodeReadableStream));
  }

  async onModuleDestroy(): Promise<void> {
    await this.handler.close();
  }
}

/**
 * AI agents: the MCP endpoint at `/mcp`. Off until an instance admin chooses a mode (Admin,
 * Instance); maps narrow it in their sharing settings. Without this module there is no `/mcp`.
 */
@Module({ imports: [MappingModule, RoutingModule, AuditModule], controllers: [McpController] })
export class McpModule {}
