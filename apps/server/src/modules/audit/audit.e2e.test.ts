import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { isComplete, type AuditRecord } from '@darkbeacon/audit';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type {
  AuditEntryDto,
  AuditPageDto,
  AuditRevertDto,
  AuditVerifyDto,
  ConnectionDto,
  MapDto,
  MapSystemDto,
  MeDto,
  SignatureDto,
} from '@darkbeacon/shared';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';

const JITA = 30000142;
const PERIMETER = 30000144;
const AMARR = 30002187;

/** A browser with a cookie jar, a user agent and a country header (as a CDN in front would add). */
class Browser {
  readonly cookies = new Map<string, string>();

  constructor(
    private readonly base: string,
    private readonly country = 'DE',
  ) {}

  async request(path: string, init: { method?: string; json?: unknown } = {}): Promise<Response> {
    const response = await fetch(`http://${this.base}${path}`, {
      method: init.method ?? 'GET',
      redirect: 'manual',
      headers: {
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        'user-agent': 'AuditTest/1.0',
        'cf-ipcountry': this.country,
        ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split('; ');
      const [name, value] = pair!.split('=') as [string, string];
      if (header.includes('Max-Age=0')) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return response;
  }

  async json<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
    const response = await this.request(path, init);
    expect(response.status, `${init.method ?? 'GET'} ${path}: ${response.status}`).toBeLessThan(300);
    return (await response.json()) as T;
  }
}

describeEachDialect('audit trail over HTTP', (t) => {
  let app: NestFastifyApplication;
  let base: string;

  beforeEach(async () => {
    const config = {
      ...parseEnv({ NODE_ENV: 'test', PUBLIC_URL: 'http://dbk.test', DEMO_MODE: 'true' }),
      secretKey: 's'.repeat(32),
    };
    app = await createApp(config, { database: t.db, logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  const signIn = async (name: string, character: string, country?: string) => {
    const browser = new Browser(base, country);
    const me = await browser.json<MeDto>('/api/auth/dev', {
      method: 'POST',
      json: { name, character: { name: character } },
    });
    await browser.json('/api/accounts/me/main-character', {
      method: 'PUT',
      json: { characterId: me.characters[0]!.id },
    });
    return { browser, me };
  };

  const history = (b: Browser, path: string) => b.json<AuditPageDto>(path).then((p) => p.entries);

  it('records who changed what on a map, field by field, and keeps removed things', async () => {
    const { browser: alice, me } = await signIn('alice', 'Alice Main');
    const map = await alice.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Chain' } });
    const m = `/api/maps/${map.id}`;
    await alice.json(`${m}/systems`, {
      method: 'POST',
      json: { solarSystemId: JITA, position: { x: 0, y: 0 } },
    });
    await alice.json(`${m}/systems`, { method: 'POST', json: { solarSystemId: PERIMETER } });
    const connection = await alice.json<ConnectionDto>(`${m}/connections`, {
      method: 'POST',
      json: { source: JITA, target: PERIMETER },
    });
    await alice.json(`${m}/systems/${JITA}`, { method: 'PATCH', json: { status: 'hostile', tag: 'A' } });
    await alice.request(`${m}/systems/positions`, {
      method: 'POST',
      json: { positions: [{ solarSystemId: PERIMETER, x: 400, y: 40 }] },
    });
    const signature = await alice.json<SignatureDto>(`${m}/systems/${JITA}/signatures`, {
      method: 'POST',
      json: { eveId: 'ABC-123' },
    });
    await alice.json(`${m}/signatures/${signature.id}`, {
      method: 'PATCH',
      json: { group: 'gas', name: 'Sizeable' },
    });
    await alice.json(`${m}/connections/${connection.id}`, {
      method: 'PATCH',
      json: { massStatus: 'critical' },
    });
    await alice.json(`${m}/labels`, {
      method: 'PUT',
      json: { labels: [{ id: 'l1', name: 'Home', color: '#22aa66', description: '' }] },
    });
    await alice.json(m, { method: 'PATCH', json: { name: 'Home chain' } });
    await alice.request(`${m}/signatures/${signature.id}`, { method: 'DELETE' });
    await alice.request(`${m}/connections/${connection.id}`, { method: 'DELETE' });
    await alice.request(`${m}/systems/${PERIMETER}`, { method: 'DELETE' });

    // Routing publishes recomputed exits on its own time (debounced): not part of what alice did.
    const entries = (await history(alice, `${m}/history?limit=200`)).filter(
      (e) => !e.type.startsWith('routes.'),
    );
    const types = entries.map((e) => e.type).reverse();
    expect(types).toEqual([
      'map.created',
      'system.added',
      'system.added',
      'connection.added',
      'system.updated',
      'system.updated',
      'signature.added',
      'signature.updated',
      'connection.updated',
      'labels.changed',
      'map.settings_changed',
      'signature.removed',
      'connection.removed',
      'system.removed',
    ]);
    // Every entry: actor with names, the character in use, channel and origin, and a diff or a snapshot.
    for (const entry of entries) {
      expect(entry.recorded, entry.type).toBe(true);
      expect(entry.actor).toMatchObject({
        kind: 'account',
        accountId: me.account.id,
        accountName: 'alice',
        characterName: 'Alice Main',
      });
      expect(entry.channel).toEqual({ kind: 'web', id: null });
      expect(entry.origin).toEqual({ country: 'DE', userAgent: 'AuditTest/1.0' });
      expect(isComplete(entry as unknown as AuditRecord), entry.type).toBe(true);
    }
    const byType = (type: string) => entries.find((e) => e.type === type)!;
    expect(entries.find((e) => e.type === 'system.updated' && e.diff.status)!.diff).toEqual({
      status: { before: 'unknown', after: 'hostile' },
      tag: { before: null, after: 'A' },
    });
    expect(byType('signature.updated').diff).toEqual({
      group: { before: 'unknown', after: 'gas' },
      name: { before: null, after: 'Sizeable' },
    });
    expect(byType('map.settings_changed').diff).toEqual({ name: { before: 'Chain', after: 'Home chain' } });
    expect(byType('signature.removed').removed).toMatchObject({
      eveId: 'ABC-123',
      group: 'gas',
      name: 'Sizeable',
    });
    expect(byType('connection.removed').removed).toMatchObject({
      source: JITA,
      target: PERIMETER,
      massStatus: 'critical',
    });
    expect(byType('system.removed').removed).toMatchObject({
      solarSystemId: PERIMETER,
      position: { x: 400, y: 40 },
    });

    // Per-system history: the system, its signatures and the connections touching it.
    const perimeter = await history(alice, `${m}/systems/${PERIMETER}/history`);
    expect(perimeter.map((e) => e.type).reverse()).toEqual([
      'system.added',
      'connection.added',
      'system.updated',
      'connection.updated',
      'connection.removed',
      'system.removed',
    ]);
    const perConnection = await history(alice, `${m}/connections/${connection.id}/history`);
    expect(perConnection.map((e) => e.type).reverse()).toEqual([
      'connection.added',
      'connection.updated',
      'connection.removed',
    ]);

    // Filters by type and paging.
    const sigs = await history(alice, `${m}/history?types=signature.*`);
    expect(sigs.map((e) => e.type)).toEqual(['signature.removed', 'signature.updated', 'signature.added']);
    const first = await alice.json<AuditPageDto>(`${m}/history?limit=5`);
    expect(first.entries).toHaveLength(5);
    const second = await alice.json<AuditPageDto>(`${m}/history?limit=5&before=${first.nextCursor}`);
    expect(second.entries[0]!.seq).toBe(first.entries[4]!.seq - 1);
  });

  it('filters by person, hides the origin from viewers and reverts single changes safely', async () => {
    const { browser: alice } = await signIn('alice', 'Alice Main');
    const { browser: bob, me: bobMe } = await signIn('bob', 'Bob Alt', 'FR');
    const map = await alice.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Chain' } });
    const m = `/api/maps/${map.id}`;
    await alice.json(`${m}/access-rules`, {
      method: 'POST',
      json: { subjectKind: 'account', subjectId: bobMe.account.id, role: 'member' },
    });
    await alice.json(`${m}/systems`, { method: 'POST', json: { solarSystemId: JITA } });
    await bob.json(`${m}/systems`, { method: 'POST', json: { solarSystemId: AMARR } });
    await bob.json(`${m}/systems/${JITA}`, { method: 'PATCH', json: { status: 'hostile' } });

    const bobs = await history(alice, `${m}/history?accountId=${bobMe.account.id}`);
    expect(bobs.map((e) => e.type)).toEqual(['system.updated', 'system.added']);
    expect(bobs[0]!.origin).toEqual({ country: 'FR', userAgent: 'AuditTest/1.0' });
    // Bob is a member, not a map admin: no request origins for him.
    expect((await history(bob, `${m}/history`)).every((e) => e.origin === null)).toBe(true);

    // Revert Bob's status change; the revert is recorded too, and the original says so.
    const change = bobs[0]!;
    const reverted = await alice.json<AuditRevertDto>(`${m}/history/${change.id}/revert`, { method: 'POST' });
    expect(reverted.entries).toHaveLength(1);
    expect(reverted.entries[0]).toMatchObject({
      type: 'system.updated',
      revertOf: change.id,
      diff: { status: { before: 'hostile', after: 'unknown' } },
      actor: { accountName: 'alice' },
    });
    const systems = await alice
      .json<{ systems: MapSystemDto[] }>(`/api/streams/map:${map.id}/snapshot`)
      .then((s) => (s as unknown as { data: { systems: MapSystemDto[] } }).data.systems);
    expect(systems.find((s) => s.solarSystemId === JITA)!.status).toBe('unknown');
    const again = await history(alice, `${m}/history`);
    expect(again.find((e) => e.id === change.id)).toMatchObject({
      revertedBy: reverted.entries[0]!.id,
      revertible: false,
    });
    expect((await alice.request(`${m}/history/${change.id}/revert`, { method: 'POST' })).status).toBe(409);

    // A change somebody changed again since cannot be reverted over their change.
    await alice.json(`${m}/systems/${JITA}`, { method: 'PATCH', json: { tag: 'A' } });
    const tagA = (await history(alice, `${m}/history?types=system.updated&limit=1`))[0]!;
    await bob.json(`${m}/systems/${JITA}`, { method: 'PATCH', json: { tag: 'B' } });
    const conflict = await alice.request(`${m}/history/${tagA.id}/revert`, { method: 'POST' });
    expect(conflict.status).toBe(409);

    // Removed things come back: Bob's system removal.
    await bob.request(`${m}/systems/${AMARR}`, { method: 'DELETE' });
    const removal = (await history(alice, `${m}/history?types=system.removed`))[0]!;
    await alice.json(`${m}/history/${removal.id}/revert`, { method: 'POST' });
    expect((await history(alice, `${m}/history?limit=1`))[0]).toMatchObject({
      type: 'system.added',
      revertOf: removal.id,
    });

    // Pure activity cannot be reverted; viewers cannot revert at all.
    const created = (await history(alice, `${m}/history?types=map.created`))[0]!;
    expect(created.revertible).toBe(false);
    expect((await alice.request(`${m}/history/${created.id}/revert`, { method: 'POST' })).status).toBe(400);
  });

  it('keeps an instance audit for admins, exports it and verifies the hash chain', async () => {
    const { browser: owner } = await signIn('owner', 'Owner Main');
    const { browser: pilot, me: pilotMe } = await signIn('pilot', 'Pilot Main');
    expect((await owner.request('/api/auth/discord/callback?error=access_denied')).status).toBe(302);
    await owner.json('/api/admin/settings', { method: 'PATCH', json: { eventRetentionDays: 400 } });
    await owner.json(`/api/admin/accounts/${pilotMe.account.id}/role`, {
      method: 'PUT',
      json: { role: 'admin' },
    });
    const map = await owner.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Chain' } });
    const webhook = await owner.json<{ id: string }>(`/api/maps/${map.id}/webhooks`, {
      method: 'POST',
      json: { url: 'https://hooks.example.com/services/T000/B000/secret-token', events: ['system.*'] },
    });
    await owner.request(`/api/maps/${map.id}/webhooks/${webhook.id}`, { method: 'DELETE' });
    await pilot.request('/api/auth/logout', { method: 'POST' });

    expect((await new Browser(base).request('/api/admin/audit')).status).toBe(401);
    const entries = await history(owner, '/api/admin/audit?limit=200');
    const types = entries.map((e) => e.type);
    for (const type of [
      'auth.signed_in',
      'auth.sign_in_failed',
      'auth.signed_out',
      'settings.changed',
      'access.role_changed',
      'webhook.created',
      'webhook.removed',
    ])
      expect(types, type).toContain(type);
    // Map state is not part of the instance audit.
    expect(types).not.toContain('map.created');
    const settings = entries.find((e) => e.type === 'settings.changed')!;
    expect(settings.diff).toEqual({ eventRetentionDays: { before: null, after: 400 } });
    const role = entries.find((e) => e.type === 'access.role_changed')!;
    expect(role.diff).toEqual({ role: { before: 'user', after: 'admin' } });
    expect(entries.find((e) => e.type === 'auth.sign_in_failed')).toMatchObject({
      actor: { kind: 'system', id: 'sign-in', accountId: null },
      origin: { country: 'DE', userAgent: 'AuditTest/1.0' },
    });
    // Webhook URLs carry credentials: only where they point is kept.
    const created = entries.find((e) => e.type === 'webhook.created')!;
    expect(JSON.stringify(created)).not.toContain('secret-token');
    expect(created.diff.url!.after).toMatch(/^https:\/\/hooks\.example\.com\/… \(\w{6}\)$/);
    expect(entries.find((e) => e.type === 'webhook.removed')!.removed).toMatchObject({ mapId: map.id });
    // By map: only that map's access and webhooks.
    const ofMap = await history(owner, `/api/admin/audit?mapId=${map.id}`);
    expect(ofMap.map((e) => e.type)).toEqual(['webhook.removed', 'webhook.created']);
    // By person.
    const pilots = await history(owner, `/api/admin/audit?accountId=${pilotMe.account.id}`);
    expect(pilots.map((e) => e.type)).toEqual([
      'auth.signed_out',
      'access.account_changed', // its sessions ended
      'access.role_changed',
      'auth.signed_in',
    ]);

    const csv = await owner.request('/api/admin/audit/export?format=csv&types=auth.*');
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.headers.get('content-disposition')).toMatch(/attachment; filename="instance-audit-.*\.csv"/);
    const lines = (await csv.text()).trim().split('\r\n');
    expect(lines[0]).toBe(
      'time,type,map,person,character,channel,entity,changes,removed,country,userAgent,revertOf,via,id',
    );
    expect(lines.length).toBe(1 + entries.filter((e) => e.type.startsWith('auth.')).length);
    const json = (await (
      await owner.request('/api/admin/audit/export?format=json')
    ).json()) as AuditEntryDto[];
    expect(json.map((e) => e.id)).toEqual(entries.map((e) => e.id));

    const verified = await owner.json<AuditVerifyDto>('/api/admin/audit/verify', { method: 'POST' });
    expect(verified.ok).toBe(true);
    expect(verified.streams.find((s) => s.stream === 'audit:instance')!.checked).toBeGreaterThan(5);
    // Someone edits a stored event behind the server's back: the chain says where.
    const tampered = entries.find((e) => e.type === 'settings.changed')!;
    await t.db
      .db<{ event_log: { id: string; data: string } }>()
      .updateTable('event_log')
      .set({ data: '{"eventRetentionDays":1}' })
      .where('id', '=', tampered.id)
      .execute();
    const broken = await owner.json<AuditVerifyDto>('/api/admin/audit/verify', { method: 'POST' });
    expect(broken.ok).toBe(false);
    expect(broken.streams.find((s) => !s.ok)).toMatchObject({
      stream: 'audit:instance',
      brokenAt: { seq: tampered.seq, id: tampered.id },
    });
  });
});
