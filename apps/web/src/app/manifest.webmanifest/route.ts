import { connection } from 'next/server';
import { pwaEnabled } from '../../pwa/config';
import { buildManifest } from '../../pwa/manifest';

/** The web app manifest; a 404 while the app install is switched off (`PWA=off`). */
export async function GET(): Promise<Response> {
  await connection();
  if (!pwaEnabled(process.env)) return new Response('Not found', { status: 404 });
  return new Response(JSON.stringify(buildManifest()), {
    headers: {
      'content-type': 'application/manifest+json; charset=utf-8',
      'cache-control': 'no-cache',
    },
  });
}
