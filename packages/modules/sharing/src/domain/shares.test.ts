import { describe, expect, it } from 'vitest';
import {
  acceptShare,
  checkOffer,
  checkRevoke,
  offerShare,
  shareScopes,
  updateShare,
  type Share,
} from './shares.js';

const A = { instance: 'local', mapId: 'corp-a' };
const ALLIANCE = { instance: 'local', mapId: 'alliance' };

const offer = (targetAdmin: boolean): Share =>
  offerShare({
    id: 's1',
    source: A,
    target: ALLIANCE,
    level: 'read',
    scopes: ['connectionStatus', 'signatures', 'intel'],
    by: 'alice',
    sides: { sourceAdmin: true, targetAdmin },
    now: 10,
  });

describe('share consent', () => {
  it('waits for the target’s admin, unless the offerer administers both', () => {
    expect(offer(false)).toMatchObject({ status: 'offered', acceptedBy: null, acceptedAt: null });
    expect(offer(true)).toMatchObject({ status: 'active', acceptedBy: 'alice', acceptedAt: 10 });
    expect(shareScopes(offer(false))).toEqual(['topology', 'connectionStatus', 'signatures', 'intel']);
  });

  it('is accepted by the target’s admin only, who may keep less than offered', () => {
    const share = offer(false);
    expect(() =>
      acceptShare(share, { by: 'bob', sides: { sourceAdmin: true, targetAdmin: false }, now: 11 }),
    ).toThrow(/receiving map/);
    const accepted = acceptShare(share, {
      by: 'carol',
      sides: { sourceAdmin: false, targetAdmin: true },
      scopes: ['signatures'],
      now: 11,
    });
    expect(accepted).toMatchObject({ status: 'active', acceptedBy: 'carol' });
    expect(shareScopes(accepted)).toEqual(['topology', 'signatures']);
    expect(() =>
      acceptShare(share, {
        by: 'carol',
        sides: { sourceAdmin: false, targetAdmin: true },
        scopes: ['characters'],
        now: 11,
      }),
    ).toThrow(/does not offer characters/);
    expect(() =>
      acceptShare(accepted, { by: 'carol', sides: { sourceAdmin: false, targetAdmin: true }, now: 12 }),
    ).toThrow(/already/);
  });

  it('lets each side change only its own part', () => {
    const share = offer(true);
    const source = { sourceAdmin: true, targetAdmin: false };
    const target = { sourceAdmin: false, targetAdmin: true };
    expect(() => updateShare(share, { level: 'read-write' }, target, 20)).toThrow(/shared map/);
    expect(() => updateShare(share, { hidden: true }, source, 20)).toThrow(/receiving map/);
    expect(updateShare(share, { level: 'read-write' }, source, 20)).toMatchObject({
      level: 'read-write',
      updatedAt: 20,
    });
    expect(updateShare(share, { hidden: true }, target, 20)).toMatchObject({ hidden: true });
    expect(updateShare(share, { level: 'read' }, source, 20)).toBeNull();

    // The target narrows; the source narrowing its offer later keeps the target's choice inside it.
    const narrowed = updateShare(share, { scopes: ['signatures', 'intel'] }, target, 21)!;
    expect(shareScopes(narrowed)).toEqual(['topology', 'signatures', 'intel']);
    const reoffered = updateShare(narrowed, { scopes: ['signatures'] }, source, 22)!;
    expect(shareScopes(reoffered)).toEqual(['topology', 'signatures']);
    expect(() => updateShare(share, { scopes: ['characters'] }, target, 23)).toThrow(/does not offer/);
  });

  it('refuses sharing a map with itself, a composite, or twice', () => {
    expect(() => checkOffer({ ...A, kind: 'standard' }, A, [])).toThrow(/itself/);
    expect(() => checkOffer({ ...ALLIANCE, kind: 'composite' }, A, [])).toThrow(/composite/);
    expect(() => checkOffer({ ...A, kind: 'standard' }, ALLIANCE, [offer(false)])).toThrow(/already/);
    expect(() => checkOffer({ ...A, kind: 'standard' }, ALLIANCE, [])).not.toThrow();
  });

  it('can be revoked by either side', () => {
    expect(() => checkRevoke({ sourceAdmin: false, targetAdmin: false })).toThrow();
    expect(() => checkRevoke({ sourceAdmin: false, targetAdmin: true })).not.toThrow();
    expect(() => checkRevoke({ sourceAdmin: true, targetAdmin: false })).not.toThrow();
  });
});
