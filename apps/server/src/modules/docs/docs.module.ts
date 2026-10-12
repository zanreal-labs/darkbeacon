import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Controller, Get, Inject, Module, Param, Res } from '@nestjs/common';
import { NotFoundError } from '@darkbeacon/core';
import { buildAsyncApi, buildOpenApi, nestPath, routes } from '@darkbeacon/shared';
import type { FastifyReply } from 'fastify';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG } from '../../platform/tokens.js';

/** The Scalar API reference, served from this server (no CDN, no fonts, no telemetry). */
function scalarDir(): string | null {
  try {
    return join(dirname(fileURLToPath(import.meta.resolve('@scalar/api-reference'))), 'browser');
  } catch {
    return null;
  }
}

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * The page only loads files of this server: the CSP proves it (and keeps a script injected into
 * the description from loading anything either).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="robots" content="noindex" />
    <title>Darkbeacon API</title>
    <link rel="icon" href="/icon.svg" />
  </head>
  <body>
    <div id="app"></div>
    <script src="/api/docs/assets/standalone.js"></script>
    <script src="/api/docs/assets/darkbeacon-init.js"></script>
  </body>
</html>
`;

/** Starts the reference: the instance's own description, Bearer auth, nothing phoned home. */
const INIT = `Scalar.createApiReference('#app', {
  url: '/api/openapi.json',
  withDefaultFonts: false,
  telemetry: false,
  showDeveloperTools: 'never',
  hideModels: false,
  persistAuth: false,
  documentDownloadType: 'json',
  defaultOpenFirstTag: false,
  mcp: { disabled: true },
  agent: { disabled: true },
  externalUrls: { dashboardUrl: '', registryUrl: '', proxyUrl: '', apiBaseUrl: '' },
  authentication: { preferredSecurityScheme: 'bearerAuth' },
  metaData: { title: 'Darkbeacon API' },
});
`;

@Controller()
export class DocsController {
  private openapi: string | null = null;
  private asyncapi: string | null = null;
  private readonly assets = scalarDir();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get(nestPath(routes.docs.openapi.path))
  openApi(@Res({ passthrough: true }) reply: FastifyReply): string {
    this.openapi ??= JSON.stringify(buildOpenApi({ publicUrl: this.config.publicUrl }));
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('cache-control', 'public, max-age=300');
    return this.openapi;
  }

  @Get(nestPath(routes.docs.asyncapi.path))
  asyncApi(@Res({ passthrough: true }) reply: FastifyReply): string {
    this.asyncapi ??= JSON.stringify(buildAsyncApi({ publicUrl: this.config.publicUrl }));
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('cache-control', 'public, max-age=300');
    return this.asyncapi;
  }

  @Get(nestPath(routes.docs.ui.path))
  page(@Res({ passthrough: true }) reply: FastifyReply): string {
    reply.header('content-type', 'text/html; charset=utf-8');
    reply.header('content-security-policy', CSP);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    return PAGE;
  }

  @Get(nestPath(routes.docs.asset.path))
  async asset(
    @Param('*') file: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer | string> {
    reply.header('x-content-type-options', 'nosniff');
    if (file === 'darkbeacon-init.js') {
      reply.header('content-type', TYPES['.js']!);
      reply.header('cache-control', 'no-cache');
      return INIT;
    }
    const type = TYPES[extname(file)];
    if (!this.assets || !type) throw new NotFoundError('File');
    const path = normalize(join(this.assets, file));
    if (!path.startsWith(this.assets + sep)) throw new NotFoundError('File');
    try {
      const body = await readFile(path);
      reply.header('content-type', type);
      // Chunks carry a content hash in their name; the entry does not.
      reply.header(
        'cache-control',
        file.startsWith('chunks/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      );
      return body;
    } catch {
      throw new NotFoundError('File');
    }
  }
}

/** The API described: OpenAPI 3.1, AsyncAPI 3.0 and the reference page at /api/docs. */
@Module({ controllers: [DocsController] })
export class DocsModule {}
