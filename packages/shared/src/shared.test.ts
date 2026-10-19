import { describe, expect, it } from 'vitest';
import { ClientMessage, ServerMessage } from './protocol.js';
import { buildPath, nestPath, routes } from './routes.js';
import { CreateAccessRuleRequest } from './dto/access.js';
import { fatigueMinutesLeft } from './dto/jumps.js';
import { isMergedCopy, isMergeEvent } from './dto/sharing.js';
import { shipSizeForJumpMass } from './dto/wormholes.js';

describe('ship size of a wormhole type', () => {
  it('follows the jump masses EVE University lists', () => {
    expect(shipSizeForJumpMass(null)).toBeNull();
    expect(shipSizeForJumpMass(0)).toBeNull();
    expect(shipSizeForJumpMass(5_000_000)).toBe('small');
    expect(shipSizeForJumpMass(20_000_000)).toBe('medium');
    expect(shipSizeForJumpMass(62_000_000)).toBe('medium');
    expect(shipSizeForJumpMass(375_000_000)).toBe('large');
    expect(shipSizeForJumpMass(410_000_000)).toBe('large');
    // R081 as the wiki lists it: still too small for a freighter.
    expect(shipSizeForJumpMass(450_000_000)).toBe('large');
    expect(shipSizeForJumpMass(1_000_000_000)).toBe('xlarge');
    expect(shipSizeForJumpMass(1_350_000_000)).toBe('capital');
    expect(shipSizeForJumpMass(2_000_000_000)).toBe('capital');
  });
});

describe('jump fatigue left', () => {
  it('counts whole minutes up to the 5 hour cap and never below none', () => {
    const now = Date.UTC(2026, 9, 19, 12);
    expect(fatigueMinutesLeft(null, now)).toBe(0);
    expect(fatigueMinutesLeft(now - 1000, now)).toBe(0);
    expect(fatigueMinutesLeft(now + 30_000, now)).toBe(1);
    expect(fatigueMinutesLeft(now + 90 * 60_000, now)).toBe(90);
    expect(fatigueMinutesLeft(now + 8 * 3_600_000, now)).toBe(300);
  });
});

describe('ws protocol', () => {
  it('parses client messages', () => {
    expect(ClientMessage.parse({ op: 'subscribe', stream: 'map:1', sinceSeq: 4 })).toEqual({
      op: 'subscribe',
      stream: 'map:1',
      sinceSeq: 4,
    });
    expect(ClientMessage.safeParse({ op: 'subscribe' }).success).toBe(false);
    expect(ClientMessage.safeParse({ op: 'nope' }).success).toBe(false);
  });

  it('parses server events', () => {
    const msg = {
      op: 'event',
      event: {
        id: 'x',
        seq: 1,
        stream: 'instance',
        type: 'access.role_changed',
        occurredAt: 1,
        actor: { kind: 'system', id: 'test' },
        data: {},
        v: 1,
      },
    };
    expect(ServerMessage.parse(msg)).toEqual(msg);
  });
});

describe('routes', () => {
  it('builds paths', () => {
    expect(buildPath(routes.systems.update.path, { mapId: 'a b', solarSystemId: 31000001 })).toBe(
      '/api/maps/a%20b/systems/31000001',
    );
    expect(nestPath(routes.maps.get.path)).toBe('maps/:mapId');
  });

  it('has unique method + path pairs', () => {
    const all = Object.values(routes).flatMap((r) => ('method' in r ? [r] : Object.values(r)));
    const keys = all.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('requires a guild for Discord role rules', () => {
    const base = { subjectKind: 'discordRole', subjectId: '1', role: 'member' } as const;
    expect(CreateAccessRuleRequest.safeParse(base).success).toBe(false);
    expect(CreateAccessRuleRequest.safeParse({ ...base, guildId: '2' }).success).toBe(true);
  });
});

describe('merged events', () => {
  it('tells the merge’s events and its copies apart', () => {
    const by = (id: string) => ({ actor: { kind: 'system', id } });
    expect(isMergeEvent(by('sharing'))).toBe(true);
    expect(isMergeEvent(by('sharing-copy'))).toBe(true);
    expect(isMergedCopy(by('sharing'))).toBe(false);
    expect(isMergedCopy(by('sharing-copy'))).toBe(true);
    expect(isMergeEvent({ actor: { kind: 'account', id: 'sharing' } })).toBe(false);
  });
});
