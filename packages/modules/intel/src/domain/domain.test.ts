import { describe, expect, it } from 'vitest';
import {
  activeGroups,
  activitySeries,
  esiHour,
  factionShortName,
  groupAttackers,
  HOUR,
  isWormholeSpace,
  killsLastHour,
  lastHours,
  latestHour,
  regionHolders,
  shownClaim,
  type Killmail,
  type KillParty,
  type SpaceFacts,
} from './index.js';

const T0 = Date.UTC(2026, 9, 12, 14, 30);
const party = (
  corp: number | null,
  alliance: number | null = null,
  extra: Partial<KillParty> = {},
): KillParty => ({
  characterId: null,
  corporationId: corp,
  allianceId: alliance,
  factionId: null,
  shipTypeId: null,
  ...extra,
});

function kill(id: number, time: number, victim: KillParty, attackers: KillParty[]): Killmail {
  return {
    id,
    hash: `h${id}`,
    systemId: 31000005,
    time,
    value: 1e6,
    npc: false,
    solo: attackers.length === 1,
    victim,
    finalBlow: attackers[0] ?? null,
    attackerCount: attackers.length,
    attackers: groupAttackers(attackers),
  };
}

describe('hourly activity', () => {
  it('files ESI figures under the hour before Last-Modified', () => {
    expect(esiHour(Date.UTC(2026, 9, 12, 14, 2))).toBe(Date.UTC(2026, 9, 12, 13));
    expect(esiHour(Date.UTC(2026, 9, 12, 14, 0))).toBe(Date.UTC(2026, 9, 12, 13));
  });

  it('fills hours ESI answered without the system with zero and the rest with null', () => {
    const hours = lastHours(T0 - HOUR, 3);
    const [h1, h2, h3] = hours as [number, number, number];
    const series = activitySeries(
      7,
      [{ systemId: 7, hour: h3, shipKills: 4, podKills: 1, npcKills: 30, jumps: null }],
      { kills: new Set([h2, h3]), jumps: new Set([h3]) },
      hours,
    );
    expect(series.map((h) => [h.hour, h.shipKills, h.jumps])).toEqual([
      [h1, null, null],
      [h2, 0, null],
      [h3, 4, 0],
    ]);
    expect(latestHour(series, T0)).toMatchObject({ shipKills: 4, podKills: 1 });
  });

  it('counts zKillboard alone when complete, else whichever is larger', () => {
    const esi = { shipKills: 6, podKills: 2 };
    expect(killsLastHour({ zkill: 3, esi, complete: true })).toBe(3);
    expect(killsLastHour({ zkill: 3, esi, complete: false })).toBe(8);
    expect(killsLastHour({ zkill: 11, esi, complete: false })).toBe(11);
    expect(killsLastHour({ zkill: 0, esi: null, complete: false })).toBe(0);
  });
});

describe('who is active', () => {
  it('counts each alliance (or corporation without one) once per killmail, NPCs left out', () => {
    const kills = [
      kill(1, T0, party(98000001, 99000001), [
        party(98000002, 99000002),
        party(98000002, 99000002),
        party(98000003),
      ]),
      kill(2, T0 - 2 * HOUR, party(98000003), [party(98000002, 99000002), party(1000125)]),
      kill(3, T0 - 3 * 24 * HOUR, party(98000004), [party(98000002, 99000002)]),
    ];
    // Busiest first; then more kills; then by id.
    expect(activeGroups(kills, T0 - HOUR)).toEqual([
      { kind: 'corporation', id: 98000003, kills: 1, losses: 0 },
      { kind: 'alliance', id: 99000002, kills: 1, losses: 0 },
      { kind: 'alliance', id: 99000001, kills: 0, losses: 1 },
    ]);
    const day = activeGroups(kills, T0 - 24 * HOUR);
    expect(day[0]).toEqual({ kind: 'alliance', id: 99000002, kills: 2, losses: 0 });
    expect(day.find((g) => g.id === 98000003)).toEqual({
      kind: 'corporation',
      id: 98000003,
      kills: 1,
      losses: 1,
    });
    expect(day.some((g) => g.id === 1000125)).toBe(false);
  });

  it('groups attackers by corporation, most pilots first', () => {
    expect(
      groupAttackers([
        party(5_000_000, 99),
        party(4_000_000),
        party(5_000_000, 99),
        party(null, null, { factionId: 500010 }),
      ]),
    ).toEqual([
      { corporationId: 5_000_000, allianceId: 99, pilots: 2 },
      { corporationId: 4_000_000, allianceId: null, pilots: 1 },
    ]);
  });
});

describe('sovereignty', () => {
  const nullSec: SpaceFacts = { security: -0.3, whClass: 9, region: 'Delve' };
  const highSec: SpaceFacts = { security: 0.9, whClass: 7, region: 'The Forge' };
  const wormhole: SpaceFacts = { security: -0.99, whClass: 3, region: 'C-R00001' };
  const pochven: SpaceFacts = { security: -1, whClass: 25, region: 'Pochven' };
  const alliance = { kind: 'alliance' as const, allianceId: 1, corporationId: 2 };
  const faction = { kind: 'faction' as const, factionId: 500019 };

  it('shows alliances anywhere in k-space and factions only in null-sec and Pochven', () => {
    expect(shownClaim(alliance, nullSec)).toBe(alliance);
    expect(shownClaim(faction, nullSec)).toBe(faction);
    expect(shownClaim(faction, pochven)).toBe(faction);
    expect(shownClaim(faction, highSec)).toBeNull();
    expect(shownClaim(alliance, wormhole)).toBeNull();
    expect(shownClaim(null, nullSec)).toBeNull();
    expect(isWormholeSpace({ whClass: 13 })).toBe(true);
    expect(isWormholeSpace({ whClass: 9 })).toBe(false);
  });

  it('names the alliance holding most of a region, nobody on a tie', () => {
    const systems = [1, 2, 3, 4, 5].map((id) => ({ id, space: nullSec }));
    const claims = new Map([
      [1, { kind: 'alliance' as const, allianceId: 10, corporationId: null }],
      [2, { kind: 'alliance' as const, allianceId: 10, corporationId: null }],
      [3, { kind: 'alliance' as const, allianceId: 11, corporationId: null }],
    ]);
    expect(regionHolders(systems, claims).get('Delve')).toEqual({ allianceId: 10, held: 2, total: 5 });
    claims.set(4, { kind: 'alliance', allianceId: 11, corporationId: null });
    expect(regionHolders(systems, claims).has('Delve')).toBe(false);
  });

  it('shortens faction names the way players say them', () => {
    expect(factionShortName('Guristas Pirates')).toBe('Guristas');
    expect(factionShortName("Sansha's Nation")).toBe('Sansha');
    expect(factionShortName('The Blood Raider Covenant')).toBe('Blood Raider');
    expect(factionShortName('CONCORD Assembly')).toBe('CONCORD');
    expect(factionShortName('Serpentis')).toBe('Serpentis');
  });
});
