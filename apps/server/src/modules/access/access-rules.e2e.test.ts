import { afterEach, beforeEach, expect, it } from 'vitest';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { AccessRuleDto, MapDto } from '@darkbeacon/shared';
import { startTestApp, type TestApp } from '../../test-support/test-app.js';

describeEachDialect('access rules over HTTP', (t) => {
  let s: TestApp;

  beforeEach(async () => {
    s = await startTestApp(t.db);
  });
  afterEach(async () => {
    await s.close();
  });

  const rule = async (mapId: string, user: string, subjectId: string, role: string) => {
    const r = await s.call('POST', `/api/maps/${mapId}/access-rules`, user, {
      subjectKind: 'account',
      subjectId,
      role,
    });
    return r;
  };

  it('changes roles in place, lets managers handle members and copies rules between maps', async () => {
    const map = (await s.call('POST', '/api/maps', 'alice', { name: 'Home' })).body as MapDto;
    const other = (await s.call('POST', '/api/maps', 'alice', { name: 'Staging' })).body as MapDto;

    const bob = (await rule(map.id, 'alice', 'bob', 'viewer')).body as AccessRuleDto;
    // Bob views, so he cannot read the rules; promoted to manager in place, he can.
    expect((await s.call('GET', `/api/maps/${map.id}/access-rules`, 'bob')).status).toBe(403);
    const promoted = await s.call('PATCH', `/api/maps/${map.id}/access-rules/${bob.id}`, 'alice', {
      role: 'manager',
    });
    expect(promoted).toMatchObject({ status: 200, body: { id: bob.id, role: 'manager' } });
    expect((await s.call('GET', `/api/maps/${map.id}/access-rules`, 'bob')).status).toBe(200);

    // A manager adds and blocks members, but makes no admins and touches no managers.
    const carol = await rule(map.id, 'bob', 'carol', 'member');
    expect(carol.status).toBe(201);
    const carolId = (carol.body as AccessRuleDto).id;
    expect(
      (await s.call('PATCH', `/api/maps/${map.id}/access-rules/${carolId}`, 'bob', { role: 'blocked' }))
        .status,
    ).toBe(200);
    expect((await rule(map.id, 'bob', 'dave', 'admin')).status).toBe(403);
    expect(
      (await s.call('PATCH', `/api/maps/${map.id}/access-rules/${bob.id}`, 'bob', { role: 'viewer' })).status,
    ).toBe(403);

    // Copy to the other map: admins only there.
    expect(
      (await s.call('POST', `/api/maps/${other.id}/access-rules/copy`, 'bob', { fromMapId: map.id })).status,
    ).toBe(404);
    const copied = await s.call('POST', `/api/maps/${other.id}/access-rules/copy`, 'alice', {
      fromMapId: map.id,
    });
    expect(copied).toMatchObject({ status: 200, body: { added: 2, updated: 0, skipped: 0 } });
    const rules = (await s.call('GET', `/api/maps/${other.id}/access-rules`, 'alice'))
      .body as AccessRuleDto[];
    expect(rules.map((r) => [r.subjectId, r.role])).toEqual([
      ['bob', 'manager'],
      ['carol', 'blocked'],
    ]);

    // The change is in the map's history with the role before.
    const history = (await s.call('GET', `/api/maps/${map.id}/history`, 'alice')).body as {
      entries: Array<{ type: string; diff: Record<string, unknown> }>;
    };
    expect(history.entries.find((e) => e.type === 'access.rule_changed')?.diff).toMatchObject({
      role: { before: 'member', after: 'blocked' },
    });
  });
});
