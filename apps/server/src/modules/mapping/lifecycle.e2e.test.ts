import { afterEach, beforeEach, expect, it } from 'vitest';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { AccessRuleDto, AdminMapDto, MapDto, MapSummaryDto, MeDto } from '@darkbeacon/shared';
import { SYSTEMS } from '../../adapters/mapping/testing.js';
import { startTestApp, type TestApp } from '../../test-support/test-app.js';

describeEachDialect('map lifecycle over HTTP', (t) => {
  let s: TestApp;

  beforeEach(async () => {
    s = await startTestApp(t.db, {}, { DEMO_MODE: 'true' });
  });
  afterEach(async () => {
    await s.close();
  });

  /** A real local account (demo sign-in), with one character in corporation 98000001. */
  const signUp = async (name: string): Promise<string> => {
    const r = await s.call('POST', '/api/auth/dev', null, {
      name,
      character: { name: `${name} Main`, corporationId: 98000001, allianceId: 99000001 },
    });
    expect(r.status).toBe(200);
    return (r.body as MeDto).account.id;
  };

  it('describes, hands over, deletes softly and restores maps', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');

    const created = await s.call('POST', '/api/maps', alice, {
      name: 'Home',
      description: 'Our chain',
      starterRule: { subjectKind: 'corporation', subjectId: '98000001', role: 'member' },
    });
    expect(created).toMatchObject({ status: 201, body: { description: 'Our chain' } });
    const map = created.body as MapDto;
    // The starter rule makes the creator's corporation members: bob is in it.
    const rules = (await s.call('GET', `/api/maps/${map.id}/access-rules`, alice)).body as AccessRuleDto[];
    expect(rules.map((r) => [r.subjectKind, r.subjectId, r.role])).toEqual([
      ['corporation', '98000001', 'member'],
    ]);
    expect((await s.call('GET', '/api/maps', bob)).body).toEqual([
      expect.objectContaining({ id: map.id, role: 'member', description: 'Our chain' }),
    ]);
    // A starter rule for someone else's corporation is refused.
    expect(
      (
        await s.call('POST', '/api/maps', alice, {
          name: 'Other',
          starterRule: { subjectKind: 'corporation', subjectId: '123', role: 'member' },
        })
      ).status,
    ).toBe(400);

    // Locking is for managers: bob (member) edits but cannot lock.
    await s.call('POST', `/api/maps/${map.id}/systems`, alice, { solarSystemId: SYSTEMS.c2 });
    expect(
      (await s.call('PATCH', `/api/maps/${map.id}/systems/${SYSTEMS.c2}`, bob, { locked: true })).status,
    ).toBe(403);
    expect(
      (await s.call('PATCH', `/api/maps/${map.id}/systems/${SYSTEMS.c2}`, bob, { tag: 'A' })).status,
    ).toBe(200);
    expect(
      (await s.call('PATCH', `/api/maps/${map.id}/systems/${SYSTEMS.c2}`, alice, { locked: true })).status,
    ).toBe(200);

    // Description through the settings.
    expect(
      await s.call('PATCH', `/api/maps/${map.id}`, alice, { description: 'Staging in J100101' }),
    ).toMatchObject({ status: 200, body: { description: 'Staging in J100101' } });

    // Owner handover: only the owner, to an existing account.
    expect((await s.call('PUT', `/api/maps/${map.id}/owner`, bob, { accountId: bob })).status).toBe(403);
    expect((await s.call('PUT', `/api/maps/${map.id}/owner`, alice, { accountId: 'nobody' })).status).toBe(
      400,
    );
    expect(await s.call('PUT', `/api/maps/${map.id}/owner`, alice, { accountId: bob })).toMatchObject({
      status: 200,
      body: { ownerAccountId: bob },
    });
    // Bob is admin now; alice keeps what the corporation rule gives her.
    expect(((await s.call('GET', '/api/maps', alice)).body as MapSummaryDto[])[0]?.role).toBe('member');
    expect(((await s.call('GET', '/api/maps', bob)).body as MapSummaryDto[])[0]?.role).toBe('admin');

    // Deleting hides the map from everyone; its address stays taken.
    expect((await s.call('DELETE', `/api/maps/${map.id}`, bob)).status).toBe(204);
    expect((await s.call('GET', `/api/maps/${map.id}`, bob)).status).toBe(404);
    expect((await s.call('GET', '/api/maps', alice)).body).toEqual([]);
    expect((await s.call('POST', '/api/maps', alice, { name: 'x', slug: map.slug })).status).toBe(409);

    // Instance admins see it in the inventory (not its contents), restore or purge it.
    expect((await s.call('GET', '/api/admin/maps', alice)).status).toBe(403);
    const inventory = (await s.call('GET', '/api/admin/maps', `admin:${alice}`)).body as AdminMapDto[];
    expect(inventory.find((m) => m.id === map.id)).toMatchObject({
      ownerAccountId: bob,
      ownerName: 'bob',
      systems: 1,
      rules: 1,
      deletedAt: expect.any(Number),
    });
    expect(inventory).toHaveLength(1);
    expect((await s.call('GET', `/api/maps/${map.id}`, `admin:${alice}`)).status).toBe(404);
    const restored = await s.call('POST', `/api/admin/maps/${map.id}/restore`, `admin:${alice}`);
    expect(restored).toMatchObject({ status: 200, body: { id: map.id, slug: map.slug } });
    expect((restored.body as MapDto).deletedAt).toBeUndefined();
    // Everything came back with it: the system, the rules.
    const snapshot = (await s.call('GET', `/api/streams/map:${map.id}/snapshot`, bob)).body as {
      data: { systems: Array<{ solarSystemId: number; locked: boolean }> };
    };
    expect(snapshot.data.systems).toEqual([
      expect.objectContaining({ solarSystemId: SYSTEMS.c2, locked: true }),
    ]);
    expect(((await s.call('GET', '/api/maps', alice)).body as MapSummaryDto[]).map((m) => m.id)).toContain(
      map.id,
    );

    // An admin hands it back and purges it once deleted again.
    await s.call('PUT', `/api/admin/maps/${map.id}/owner`, `admin:${alice}`, { accountId: alice });
    expect((await s.call('DELETE', `/api/admin/maps/${map.id}`, `admin:${alice}`)).status).toBe(409);
    expect((await s.call('POST', `/api/admin/maps/${map.id}/trash`, `admin:${alice}`)).status).toBe(204);
    expect((await s.call('DELETE', `/api/admin/maps/${map.id}`, `admin:${alice}`)).status).toBe(204);
    const after = (await s.call('GET', '/api/admin/maps', `admin:${alice}`)).body as AdminMapDto[];
    expect(after.find((m) => m.id === map.id)).toBeUndefined();
  });

  it('lets only admins create maps when the instance says so', async () => {
    const alice = await signUp('alice');
    expect(
      (await s.call('PATCH', '/api/admin/settings', `admin:${alice}`, { mapCreation: 'admins' })).status,
    ).toBe(200);
    expect((await s.call('POST', '/api/maps', alice, { name: 'Mine' })).status).toBe(403);
    expect((await s.call('POST', '/api/maps', `admin:${alice}`, { name: 'Mine' })).status).toBe(201);
    expect(await s.call('GET', '/api/instance', alice)).toMatchObject({ body: { mapCreation: 'admins' } });
  });
});
