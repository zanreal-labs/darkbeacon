import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiErrorBody } from '@wormwright/shared';

/** apps/web/dist, seen from apps/server/(src|dist)/web/. */
export const WEB_DIST = fileURLToPath(new URL('../../../web/dist', import.meta.url));

/**
 * Serves the built SPA: files as-is (hashed assets cached for a year) and index.html for any
 * other GET outside /api, so client-side routes survive a reload. Skipped when there is no build.
 */
export async function serveWebApp(app: NestFastifyApplication, root = WEB_DIST): Promise<boolean> {
  if (!existsSync(join(root, 'index.html'))) return false;
  await app.register(fastifyStatic, {
    root,
    wildcard: false,
    setHeaders: (res, path) => {
      res.header(
        'cache-control',
        path.includes(`${join(root, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });
  app
    .getHttpAdapter()
    .getInstance()
    .get('/*', (request, reply) => {
      if (request.url === '/api' || request.url.startsWith('/api/')) {
        const body: ApiErrorBody = { error: { code: 'not_found', message: 'Route not found' } };
        return reply.code(404).send(body);
      }
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    });
  return true;
}
