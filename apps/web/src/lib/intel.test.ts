import { describe, expect, it } from 'vitest';
import type { SystemIntelDto } from '@darkbeacon/shared';
import { holderStanding, withOwnGroups } from './intel';

const heldBy = (allianceId: number, corporationId: number | null = null): SystemIntelDto => ({
  solarSystemId: 30004759,
  sovereignty: {
    kind: 'alliance',
    holder: { id: allianceId, name: 'Goonswarm Federation', ticker: 'CONDI' },
    corporation: corporationId === null ? null : { id: corporationId, name: null, ticker: null },
  },
  regionHolder: null,
  kills1h: 0,
  npcKills1h: null,
  jumps1h: null,
  lastKillAt: null,
});

describe('standings on the client', () => {
  it("makes one's own alliance and corporation +10 before (or without) any contacts", () => {
    const standings = withOwnGroups([], [{ corporationId: 1187207583, allianceId: 1354830081 }]);
    expect(standings.get(1354830081)).toBe(10);
    expect(standings.get(1187207583)).toBe(10);
    expect(holderStanding(heldBy(1354830081), standings)).toBe(10);
    // A corporation without an alliance holds sov through its corporation id.
    expect(holderStanding(heldBy(99000001, 1187207583), standings)).toBe(10);
  });

  it('lets what the server says win (a standing set by hand), and keeps everyone else', () => {
    const standings = withOwnGroups(
      [
        { id: 1354830081, standing: 5 },
        { id: 99000666, standing: -10 },
      ],
      [{ corporationId: 1187207583, allianceId: 1354830081 }],
    );
    expect(standings.get(1354830081)).toBe(5);
    expect(standings.get(99000666)).toBe(-10);
    expect(holderStanding(heldBy(424242), standings)).toBeNull();
  });
});
