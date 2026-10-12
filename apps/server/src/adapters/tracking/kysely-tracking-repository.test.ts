import { expect, it } from 'vitest';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { CharacterPresence } from '@darkbeacon/tracking';
import { KyselyTrackingRepository } from './kysely-tracking-repository.js';

// EVE ids and epoch ms both exceed 32 bits.
const PILOT = 2_123_456_789_012;
const NOW = Date.UTC(2026, 9, 11);

describeEachDialect('KyselyTrackingRepository', (t) => {
  it('tracks and untracks characters per map', async () => {
    const repo = new KyselyTrackingRepository(t.db);
    await repo.setTracked({ mapId: 'm1', characterId: PILOT, accountId: 'alice', since: NOW }, true);
    await repo.setTracked({ mapId: 'm2', characterId: PILOT, accountId: 'alice', since: NOW + 1 }, true);
    await repo.setTracked({ mapId: 'm1', characterId: 7, accountId: 'bob', since: NOW + 2 }, true);
    // Tracking twice keeps the first entry.
    await repo.setTracked({ mapId: 'm1', characterId: PILOT, accountId: 'alice', since: NOW + 9 }, true);

    expect(await repo.listTrackedOnMap('m1')).toEqual([
      { mapId: 'm1', characterId: PILOT, accountId: 'alice', since: NOW },
      { mapId: 'm1', characterId: 7, accountId: 'bob', since: NOW + 2 },
    ]);
    expect(await repo.listTracked()).toHaveLength(3);

    await repo.setTracked({ mapId: 'm1', characterId: PILOT, accountId: 'alice', since: 0 }, false);
    expect((await repo.listTrackedOnMap('m1')).map((c) => c.characterId)).toEqual([7]);

    await repo.untrackMap('m1');
    expect(await repo.listTracked()).toEqual([
      { mapId: 'm2', characterId: PILOT, accountId: 'alice', since: NOW + 1 },
    ]);
  });

  it('saves and updates presence', async () => {
    const repo = new KyselyTrackingRepository(t.db);
    const presence: CharacterPresence = {
      characterId: PILOT,
      accountId: 'alice',
      name: 'Pilot',
      solarSystemId: null,
      shipTypeId: null,
      shipName: null,
      online: false,
      updatedAt: NOW,
    };
    expect(await repo.getPresence(PILOT)).toBeNull();
    await repo.savePresence(presence);
    expect(await repo.getPresence(PILOT)).toEqual(presence);

    const moved = { ...presence, solarSystemId: 31000005, shipTypeId: 587, shipName: 'Rifter', online: true };
    await repo.savePresence(moved);
    expect(await repo.getPresence(PILOT)).toEqual(moved);

    await repo.savePresence({ ...presence, characterId: 7, name: 'Other' });
    expect((await repo.listPresence([PILOT, 7, 8])).map((p) => p.name).sort()).toEqual(['Other', 'Pilot']);
    expect(await repo.listPresence([])).toEqual([]);
  });

  it('joins the current transaction', async () => {
    const repo = new KyselyTrackingRepository(t.db);
    await expect(
      t.db.transaction(async () => {
        await repo.setTracked({ mapId: 'm1', characterId: 1, accountId: 'a', since: NOW }, true);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await repo.listTracked()).toEqual([]);
  });
});
