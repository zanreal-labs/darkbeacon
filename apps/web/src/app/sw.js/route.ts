import { connection } from 'next/server';
import { pwaEnabled } from '../../pwa/config';
import { killSwitchScript, serviceWorkerScript, SW_HEADERS } from '../../pwa/sw-script';

/**
 * The service worker (apps/web/src/pwa/sw-script.ts). Read at request time: with `PWA=off` a
 * worker that unregisters itself replaces whatever browsers installed before.
 */
export async function GET(): Promise<Response> {
  await connection();
  const body = pwaEnabled(process.env)
    ? serviceWorkerScript(process.env.DBK_BUILD_ID ?? 'dev')
    : killSwitchScript();
  return new Response(body, { headers: SW_HEADERS });
}
