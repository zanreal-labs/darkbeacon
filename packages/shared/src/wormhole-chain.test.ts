import { describe, expect, it } from 'vitest';
import { inWormholeSpace, wormholeChain } from './wormhole-chain.js';

const HOME = 31001269; // C2
const WH = 31001542;
const EXIT = 30000323; // null-sec, out of WH
const NEXT = 30000324; // a gate on from the exit
const STAGING = 30000772; // k-space, reached by cyno
const CYNO = 30000544;
const BRIDGE_A = 30000775;
const BRIDGE_B = 30000531;

describe('the wormhole chain', () => {
  it('tells wormhole space by id', () => {
    expect(inWormholeSpace(HOME)).toBe(true);
    expect(inWormholeSpace(EXIT)).toBe(false);
    expect(inWormholeSpace(32000001)).toBe(false); // Abyssal
  });

  it('keeps home, the holes, the exits and one gate on, and leaves trips through known space out', () => {
    const chain = wormholeChain(
      [
        { solarSystemId: HOME, status: 'home' },
        ...[WH, EXIT, NEXT, STAGING, CYNO, BRIDGE_A, BRIDGE_B].map((solarSystemId) => ({ solarSystemId })),
      ],
      [
        { source: HOME, target: WH, type: 'wormhole' },
        { source: WH, target: EXIT, type: 'wormhole' },
        { source: EXIT, target: NEXT, type: 'gate' },
        { source: NEXT, target: STAGING, type: 'gate' },
        // Wanderer maps a cyno jump between known-space systems as a wormhole.
        { source: STAGING, target: CYNO, type: 'wormhole' },
        { source: BRIDGE_A, target: BRIDGE_B, type: 'bridge' },
      ],
    );
    // One gate on from the exit stays; the next gate does not.
    expect([...chain].sort()).toEqual([EXIT, HOME, NEXT, WH].sort());
  });

  it('goes back into wormhole space from an exit, and out of a home in known space', () => {
    const OTHER = 31000005;
    const chain = wormholeChain(
      [{ solarSystemId: STAGING, status: 'home' }, { solarSystemId: EXIT }, { solarSystemId: OTHER }],
      [
        { source: STAGING, target: EXIT, type: 'wormhole' },
        { source: EXIT, target: OTHER, type: 'wormhole' },
      ],
    );
    expect(chain).toEqual(new Set([STAGING, EXIT, OTHER]));
  });
});
