import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';

describeEachDialect('API reference', (t) => {
  let app: NestFastifyApplication;
  let base: string;

  beforeEach(async () => {
    const config = { ...parseEnv({ NODE_ENV: 'test' }), secretKey: 'x'.repeat(32) };
    app = await createApp(config, { database: t.db, logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves the page and its scripts from this server only', async () => {
    const page = await fetch(`${base}/api/docs`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    const html = await page.text();
    for (const src of [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]!)) {
      const script = await fetch(`${base}${src}`);
      expect(script.status, src).toBe(200);
      expect(script.headers.get('content-type'), src).toMatch(/javascript/);
      await script.arrayBuffer();
    }
    expect((await fetch(`${base}/api/docs/assets/nothing.js`)).status).toBe(404);
    expect((await fetch(`${base}/api/docs/assets/..%2Fpackage.json`)).status).toBe(404);
  });
});
