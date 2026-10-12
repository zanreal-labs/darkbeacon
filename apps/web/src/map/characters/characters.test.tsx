// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { CharacterDto, CharacterPresenceDto, MeDto } from '@darkbeacon/shared';
import { charactersNeedingAttention, relinkHref } from '../../lib/scope-health';
import { exportPreferences, parsePreferencesFile, readBrowserOptions, writeBrowserOptions } from '../../lib/preferences';
import { isOutdated } from '../../shell/NewVersion';
import { latencyColor } from '../../shell/ConnectionIndicator';
import { describeTq } from '../../shell/EveStatus';
import { moveSection, orderedSections } from '../sidebar/layout';
import { ownOnMap, whereabouts } from './CharacterBar';
import { useFollowCharacter } from './useFollow';

const character = (id: number, over: Partial<CharacterDto> = {}): CharacterDto => ({
  id,
  name: `Pilot ${id}`,
  corporationId: 1,
  allianceId: null,
  tokenValid: true,
  linkedAt: 0,
  ...over,
});

const presence = (characterId: number, over: Partial<CharacterPresenceDto> = {}): CharacterPresenceDto => ({
  characterId,
  accountId: 'a',
  name: `Pilot ${characterId}`,
  solarSystemId: 31000001,
  shipTypeId: 587,
  shipName: 'Rifter',
  online: true,
  updatedAt: 0,
  ...over,
});

describe('my characters on the map', () => {
  it('puts the main first, then online characters, and leaves out untracked ones', () => {
    const mine = [character(1), character(2), character(3)];
    const tracked = new Map([
      [1, presence(1, { online: false })],
      [2, presence(2)],
      [3, presence(3, { online: false })],
    ]);
    expect(ownOnMap(mine, tracked, 3, 2).map((o) => [o.character.id, o.main, o.following])).toEqual([
      [3, true, false],
      [2, false, true],
      [1, false, false],
    ]);
    expect(ownOnMap(mine, new Map([[2, presence(2)]]), null, null)).toHaveLength(1);
  });

  it('says where a character is in one line', () => {
    const name = (id: number) => (id === 31000001 ? 'J100001' : undefined);
    const ship = (id: number) => (id === 587 ? 'Rifter' : undefined);
    expect(whereabouts(presence(1), name, ship)).toBe('J100001 · Rifter');
    expect(whereabouts(presence(1, { docked: true }), name, ship)).toBe('J100001 · Rifter · docked');
    expect(whereabouts(presence(1, { online: false }), name, ship)).toBe('Offline');
    expect(whereabouts(null, name, ship)).toBe('Not tracked on this map');
  });
});

describe('follow mode', () => {
  it('moves only when the followed character arrives somewhere new', () => {
    const arrived: number[] = [];
    const { rerender } = renderHook(
      ({ at, follow }: { at: number; follow: number | null }) =>
        useFollowCharacter(new Map([[7, presence(7, { solarSystemId: at })]]), follow, (id) => arrived.push(id)),
      { initialProps: { at: 1, follow: null as number | null } },
    );
    // Turning follow on does not move the view by itself.
    rerender({ at: 1, follow: 7 });
    expect(arrived).toEqual([]);
    rerender({ at: 2, follow: 7 });
    rerender({ at: 2, follow: 7 });
    rerender({ at: 3, follow: null });
    expect(arrived).toEqual([2]);
  });
});

describe('characters needing attention', () => {
  it('lists expired sign-ins first, then missing scopes in words, and keeps extras when linking again', () => {
    const me = {
      account: {} as MeDto['account'],
      characters: [
        character(1, { missingScopes: ['esi-characters.read_contacts.v1'] }),
        character(2, { tokenValid: false }),
        character(3, { missingScopes: [] }),
        character(4),
      ],
    } as MeDto;
    const attention = charactersNeedingAttention(me);
    expect(attention.map((a) => [a.character.id, a.expired, a.missing])).toEqual([
      [2, true, []],
      [1, false, ['Character contacts (standings)']],
    ]);
    expect(relinkHref('/m/home', ['wallet'])).toBe('/api/auth/eve/login?returnTo=%2Fm%2Fhome&extras=wallet');
  });
});

describe('sidebar layout', () => {
  it('orders sections by my choice, then the defaults, and moves them one place', () => {
    const layout = { hidden: [], order: ['local'] };
    expect(orderedSections(layout).slice(0, 3)).toEqual(['local', 'system', 'signatures']);
    expect(orderedSections({ hidden: [], order: [] }, ['plugin:x']).at(-1)).toBe('plugin:x');
    expect(moveSection(layout, 'system', -1).order.slice(0, 2)).toEqual(['system', 'local']);
    expect(moveSection(layout, 'local', -1)).toBe(layout);
  });
});

describe('preferences file', () => {
  it('exports this browser’s options with the server’s areas and reads them back', () => {
    window.localStorage.setItem('dbk-map-legend', 'true');
    window.localStorage.setItem('dbk-sidebar-width', '400');
    expect(readBrowserOptions()).toEqual({ 'dbk-map-legend': true });
    const file = exportPreferences({ local: { compact: true } });
    expect(file.preferences).toEqual({ local: { compact: true }, browser: { 'dbk-map-legend': true } });
    expect(parsePreferencesFile(JSON.stringify(file))).toEqual(file.preferences);
    expect(parsePreferencesFile('{"x":1}')).toMatch(/not a Darkbeacon preferences export/);
    expect(parsePreferencesFile('nope')).toMatch(/not JSON/);
    writeBrowserOptions({ 'dbk-routes-tab': 'my' }, true);
    expect(readBrowserOptions()).toEqual({ 'dbk-routes-tab': 'my' });
    expect(window.localStorage.getItem('dbk-sidebar-width')).toBe('400');
  });
});

describe('shell status', () => {
  it('offers a reload only for another build', () => {
    expect(isOutdated({ build: 'b' }, 'a')).toBe(true);
    expect(isOutdated({ build: 'a' }, 'a')).toBe(false);
    expect(isOutdated({}, 'a')).toBe(false);
    expect(isOutdated({ build: 'b' }, null)).toBe(false);
  });

  it('colours the round trip and words Tranquility', () => {
    expect(latencyColor(40)).toContain('success');
    expect(latencyColor(250)).toContain('warning');
    expect(latencyColor(900)).toContain('danger');
    const base = { players: 0, serverVersion: null, startedAt: null, checkedAt: 1, trackingPaused: false };
    expect(describeTq({ ...base, online: true, vip: false, players: 31000 }).label).toBe('31,000');
    expect(describeTq({ ...base, online: false, vip: true }).label).toBe('TQ VIP');
    expect(describeTq({ ...base, online: false, vip: false }).label).toBe('TQ down');
    expect(describeTq(undefined).label).toBe('TQ');
  });
});
