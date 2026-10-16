import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as NextServer from 'next/server';
import { darkTheme } from '@darkbeacon/theme-sdk';
import { GET as manifestRoute } from '../app/manifest.webmanifest/route';
import { GET as workerRoute } from '../app/sw.js/route';
import { pwaEnabled } from './config';
import { buildManifest, MANIFEST_BACKGROUND } from './manifest';

// Outside a request, `connection()` throws; the routes only use it to opt out of prerendering.
vi.mock('next/server', async (original) => ({
  ...(await original<typeof NextServer>()),
  connection: async () => {},
}));

// Tests run from the repository root (see vitest.config.ts).
const publicPath = (src: string) => join(process.cwd(), 'apps/web/public', src);

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): string {
  const bytes = readFileSync(file);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe('the web app manifest', () => {
  const manifest = buildManifest();

  it('opens Darkbeacon on its own origin as a standalone app', () => {
    expect(manifest).toMatchObject({
      id: '/',
      name: 'Darkbeacon',
      short_name: 'Darkbeacon',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: MANIFEST_BACKGROUND,
      theme_color: MANIFEST_BACKGROUND,
    });
    expect(manifest.description).toBeTruthy();
    expect(manifest.categories).toContain('games');
  });

  it('uses the dark theme background', () => {
    expect(MANIFEST_BACKGROUND).toBe(darkTheme.tokens['color-bg']);
  });

  it('has 192 and 512 px icons for any use and maskable, all present at their size', () => {
    const icons = manifest.icons ?? [];
    for (const purpose of ['any', 'maskable'])
      for (const size of ['192x192', '512x512'])
        expect(
          icons.some((i) => i.purpose === purpose && i.sizes === size && i.type === 'image/png'),
          `${purpose} ${size}`,
        ).toBe(true);
    for (const icon of icons) {
      const file = publicPath(icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      if (icon.type === 'image/png') expect(pngSize(file), icon.src).toBe(icon.sizes);
    }
    expect(pngSize(publicPath('/icons/apple-touch-icon.png'))).toBe('180x180');
  });

  it('has shortcuts to the map and the jump planner, inside its scope', () => {
    expect(manifest.shortcuts?.map((s) => [s.name, s.url])).toEqual([
      ['Map', '/'],
      ['Jump planner', '/jump'],
    ]);
    for (const icon of manifest.shortcuts!.flatMap((s) => s.icons ?? []))
      expect(existsSync(publicPath(icon.src)), icon.src).toBe(true);
  });
});

describe('the PWA switch', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is on unless PWA says off', () => {
    expect(pwaEnabled({})).toBe(true);
    expect(pwaEnabled({ PWA: 'on' })).toBe(true);
    for (const off of ['off', 'OFF', 'false', '0', 'no', 'disabled', ' off '])
      expect(pwaEnabled({ PWA: off })).toBe(false);
  });

  it('serves the manifest and the worker with the right headers', async () => {
    vi.stubEnv('PWA', '');
    const manifest = await manifestRoute();
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get('content-type')).toContain('application/manifest+json');
    expect((await manifest.json()).name).toBe('Darkbeacon');

    const worker = await workerRoute();
    expect(worker.headers.get('content-type')).toContain('javascript');
    expect(worker.headers.get('service-worker-allowed')).toBe('/');
    expect(worker.headers.get('cache-control')).toContain('no-cache');
    expect(await worker.text()).toContain("addEventListener('fetch'");
  });

  it('off: no manifest, and a worker that removes itself', async () => {
    vi.stubEnv('PWA', 'off');
    expect((await manifestRoute()).status).toBe(404);
    const worker = await workerRoute();
    expect(worker.headers.get('service-worker-allowed')).toBe('/');
    const script = await worker.text();
    expect(script).toContain('unregister()');
    expect(script).not.toContain("addEventListener('fetch'");
  });
});
