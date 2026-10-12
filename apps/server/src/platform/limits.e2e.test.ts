import { afterEach, beforeEach, expect, it } from 'vitest';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { CreatedApiKeyDto, MeDto } from '@darkbeacon/shared';
import { startTestApp, type TestApp } from '../test-support/test-app.js';
import { LIMITS } from './rate-limiter.js';

describeEachDialect('instance API switch and per-address limits', (t) => {
  let s: TestApp;

  beforeEach(async () => {
    s = await startTestApp(t.db, {}, { DEMO_MODE: 'true' });
  });
  afterEach(async () => {
    await s.close();
  });

  it('refuses every API key while the API is turned off, and sessions keep working', async () => {
    const me = await s.call('POST', '/api/auth/dev', null, { name: 'alice' });
    const alice = (me.body as MeDto).account.id;
    const key = await s.call('POST', '/api/accounts/me/api-keys', alice, { name: 'bot', scopes: ['*:read'] });
    const token = (key.body as CreatedApiKeyDto).token;
    const withKey = () =>
      fetch(`http://${s.base}/api/maps`, { headers: { authorization: `Bearer ${token}` } });
    expect((await withKey()).status).toBe(200);

    expect(
      (await s.call('PATCH', '/api/admin/settings', `admin:${alice}`, { apiAccess: false })).status,
    ).toBe(200);
    const refused = await withKey();
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({
      error: { message: 'API access is turned off on this instance' },
    });
    expect((await s.call('GET', '/api/maps', alice)).status).toBe(200);
    // Refusals while off are not failed logins: the address is not locked out afterwards.
    for (let i = 0; i < LIMITS.authFailures + 2; i++) await withKey();
    await s.call('PATCH', '/api/admin/settings', `admin:${alice}`, { apiAccess: true });
    expect((await withKey()).status).toBe(200);
  });

  it('limits requests per client address, whoever sends them', async () => {
    await s.close();
    // A small budget, so the test does not race the refill.
    s = await startTestApp(t.db, {}, { RATE_LIMIT_PER_ADDRESS: '20' });
    const from = (ip: string) => ({ 'x-forwarded-for': ip });
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++)
      statuses.push((await fetch(`http://${s.base}/api/health`, { headers: from('203.0.113.9') })).status);
    expect(statuses.every((x) => x === 200)).toBe(true);
    const last = await fetch(`http://${s.base}/api/health`, { headers: from('203.0.113.9') });
    expect(last.status).toBe(429);
    expect(Number(last.headers.get('retry-after'))).toBeGreaterThan(0);
    // Another address, and the server's own renderer on loopback, are not affected.
    expect((await fetch(`http://${s.base}/api/health`, { headers: from('203.0.113.10') })).status).toBe(200);
    expect((await fetch(`http://${s.base}/api/health`)).status).toBe(200);
  });
});
