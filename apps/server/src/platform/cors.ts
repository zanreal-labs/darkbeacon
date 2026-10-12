import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { WELL_KNOWN_PATHS, isApiPath } from '../web/web-proxy.js';
import { sameOrigin } from './actor.js';

const ALLOW_HEADERS = [
  'authorization',
  'content-type',
  'accept',
  'mcp-protocol-version',
  'mcp-method',
  'mcp-name',
].join(', ');
const EXPOSE_HEADERS = ['www-authenticate', 'retry-after', 'deprecation', 'content-disposition'].join(', ');

/**
 * OAuth discovery, registration and the token endpoint answer any origin: browser-based MCP
 * clients run the flow from their own pages, no cookie is involved and PKCE binds the code.
 */
const OPEN_PATHS = new Set(['/api/oauth/token', '/api/oauth/register', ...WELL_KNOWN_PATHS]);

/**
 * CORS for the API and `/mcp`: off by default. Origins an admin allows (Admin, Instance, API
 * access) may call it from a browser with an API key; credentials are never allowed, and the
 * actor guard ignores cookies on cross-origin requests anyway, so a session is never usable
 * from another site (Bearer only). The OAuth endpoints are open to every origin (`OPEN_PATHS`).
 */
export function installCors(
  app: NestFastifyApplication,
  publicUrl: string,
  allowedOrigins: () => Promise<readonly string[]>,
): void {
  const publicOrigin = new URL(publicUrl).origin;
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', async (request, reply) => {
      if (!isApiPath(request.url)) return;
      const origin = request.headers.origin;
      if (!origin || sameOrigin(request.headers, publicOrigin)) return;
      // Read on every cross-origin request (rare, one small query), so a change applies at once.
      const allowed = OPEN_PATHS.has(request.url.split('?')[0]!) || (await allowedOrigins()).includes(origin);
      const preflight =
        request.method === 'OPTIONS' && request.headers['access-control-request-method'] !== undefined;
      if (allowed) {
        void reply.header('access-control-allow-origin', origin);
        void reply.header('vary', 'Origin');
        void reply.header('access-control-expose-headers', EXPOSE_HEADERS);
      }
      if (preflight) {
        if (allowed) {
          void reply.header('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE');
          void reply.header('access-control-allow-headers', ALLOW_HEADERS);
          void reply.header('access-control-max-age', '600');
        }
        return reply.status(allowed ? 204 : 403).send();
      }
    });
}
