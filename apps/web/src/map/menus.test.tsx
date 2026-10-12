import { describe, expect, it, vi } from 'vitest';
import type { CharacterDto, LabelDto, MapRole } from '@darkbeacon/shared';
import type { MenuItem } from '../components/ContextMenu';
import { mapPermissions } from '../lib/roles';
import type { SlotEntry } from '../plugins/registry';
import { connectionFixture, MAP_ID, systemFixture } from '../test/fixtures';
import { connectionMenu, paneMenu, systemMenu } from './menus';
import type { MapStore } from './useMapStore';

const store = () => ({
  updateSystem: vi.fn<MapStore['updateSystem']>(),
  removeSystem: vi.fn<MapStore['removeSystem']>(),
  updateConnection: vi.fn<MapStore['updateConnection']>(),
  removeConnection: vi.fn<MapStore['removeConnection']>(),
});

const LABELS: LabelDto[] = [
  { id: 'l1', name: 'Scouted', color: '#3b82f6', description: '' },
  { id: 'l2', name: 'Rolling', color: '#f59e0b', description: '' },
] as LabelDto[];

const pilot = (id: number, name: string, canSetWaypoints = true): CharacterDto => ({
  id,
  name,
  corporationId: 1,
  allianceId: null,
  tokenValid: true,
  linkedAt: 0,
  canSetWaypoints,
});

/** Top-level rows as text, separators as "—". */
const rows = (items: MenuItem[]) =>
  items.map((i) => (i.kind === 'separator' ? '—' : 'label' in i ? i.label : i.kind));
const sub = (items: MenuItem[], label: string) => {
  const item = items.find((i) => i.kind === 'submenu' && i.label === label);
  if (item?.kind !== 'submenu') throw new Error(`no submenu ${label}`);
  return item.items;
};
const pick = (items: MenuItem[], label: string) => {
  const item = items.find((i) => 'label' in i && i.label === label);
  if (!item || !('onSelect' in item)) throw new Error(`no item ${label}`);
  item.onSelect();
};

function system(role: MapRole, extra: Parameters<typeof systemFixture>[1] = {}, more = {}) {
  const commands = store();
  const items = systemMenu({
    mapId: MAP_ID,
    system: systemFixture(31000005, { labelIds: ['l1'], ...extra }),
    name: 'J123456',
    labels: LABELS,
    can: mapPermissions(role),
    store: commands,
    plugins: [],
    onManageLabels: () => {},
    ...more,
  });
  return { items, commands };
}

describe('system menu', () => {
  it('shows a viewer only what a viewer can do', () => {
    expect(rows(system('viewer').items)).toEqual(['Copy name']);
    const withPilot = system('viewer', {}, { characters: [pilot(1, 'Ayla Vex')] }).items;
    expect(rows(withPilot)).toEqual(['Set destination', 'Copy name']);
    expect(rows(sub(withPilot, 'Set destination'))).toEqual(['Set destination', 'Add waypoint']);
  });

  it('keeps the member top level short: details in submenus, remove last', () => {
    const { items } = system('member');
    expect(rows(items)).toEqual([
      'Status',
      'Labels',
      'Tag',
      'Rename',
      'Hide from routes',
      '—',
      'Copy name',
      '—',
      'Remove from map',
    ]);
    expect(items.filter((i) => i.kind !== 'separator').length).toBeLessThanOrEqual(8);
    expect(rows(sub(items, 'Labels'))).toEqual(['Scouted', 'Rolling']);
  });

  it('gives managers Lock and "Manage labels…" at the bottom of Labels', () => {
    const { items } = system('manager');
    expect(rows(items)).toContain('Lock');
    expect(rows(sub(items, 'Labels'))).toEqual(['Scouted', 'Rolling', '—', 'Manage labels…']);
  });

  it('a locked system offers Unlock and neither Remove nor Hide', () => {
    const r = rows(system('manager', { locked: true }).items);
    expect(r).toContain('Unlock');
    expect(r).not.toContain('Remove from map');
    expect(r).not.toContain('Hide from routes');
  });

  it('marks the current status and sets another; toggles labels', () => {
    const { items, commands } = system('member', { status: 'hostile' });
    const status = sub(items, 'Status');
    expect(status.filter((i) => i.kind === 'radio' && i.checked).map((i) => 'label' in i && i.label)).toEqual(
      ['Hostile'],
    );
    pick(status, 'Friendly');
    expect(commands.updateSystem).toHaveBeenCalledWith(31000005, { status: 'friendly' });

    const labels = sub(items, 'Labels');
    pick(labels, 'Scouted');
    pick(labels, 'Rolling');
    expect(commands.updateSystem).toHaveBeenCalledWith(31000005, { labelIds: [] });
    expect(commands.updateSystem).toHaveBeenCalledWith(31000005, { labelIds: ['l1', 'l2'] });
  });

  it('saves the tag and name from their fields, an empty field clears them', () => {
    const { items, commands } = system('member', { tag: 'C3a' });
    const field = (label: string) => {
      const item = items.find((i) => i.kind === 'input' && i.label === label);
      if (item?.kind !== 'input') throw new Error(label);
      return item;
    };
    expect(field('Tag').hint).toBe('C3a');
    field('Tag').onSubmit('');
    field('Rename').onSubmit('Home');
    expect(commands.updateSystem).toHaveBeenCalledWith(31000005, { tag: null });
    expect(commands.updateSystem).toHaveBeenCalledWith(31000005, { customName: 'Home' });
  });

  it('routes several characters separately and leaves out those without the EVE grant', () => {
    const { items } = system(
      'member',
      {},
      {
        characters: [pilot(1, 'Ayla Vex'), pilot(2, 'Bren Tal'), pilot(3, 'No Scope', false)],
      },
    );
    expect(rows(sub(items, 'Set destination'))).toEqual([
      'Ayla Vex',
      'Set destination',
      'Add waypoint',
      'Bren Tal',
      'Set destination',
      'Add waypoint',
    ]);
  });

  it('puts plugin items into one "More" submenu at the bottom', () => {
    const entry = { key: 'p:1', pluginId: 'p', title: 'Ping', order: 0, component: () => null };
    const { items } = system('member', {}, { plugins: [entry] as SlotEntry<'systemContextMenu'>[] });
    expect(rows(items).slice(-4)).toEqual(['Copy name', 'More', '—', 'Remove from map']);
    expect(rows(sub(items, 'More'))).toEqual(['custom']);
  });
});

describe('connection menu', () => {
  const menu = (role: MapRole, extra: Parameters<typeof connectionFixture>[3] = {}) => {
    const commands = store();
    const items = connectionMenu({
      mapId: MAP_ID,
      connection: connectionFixture('c1', 1, 2, extra),
      names: { source: 'J123456', target: 'Jita' },
      can: mapPermissions(role),
      store: commands,
      plugins: [],
    });
    return { items, commands };
  };

  it('has submenus for the states, two toggles and remove last', () => {
    const { items } = menu('member');
    expect(rows(items)).toEqual([
      'Mass',
      'Time',
      'Size',
      'Bubbled',
      'Type',
      '—',
      'Dangerous',
      'Mass saved',
      '—',
      'Remove connection',
    ]);
    expect(rows(sub(items, 'Mass'))).toEqual(['Fresh', 'Reduced', 'Critical']);
    expect(rows(sub(items, 'Size'))).toEqual(['Frigate', 'Medium', 'Large', 'Freighter', 'Capital']);
    expect(rows(sub(items, 'Bubbled'))).toEqual(['None', 'Near J123456', 'Near Jita', 'Both ends']);
  });

  it('colours the mass options like the line on the map', () => {
    const mass = sub(menu('member').items, 'Mass');
    expect(mass.map((i) => i.kind === 'radio' && i.swatch?.color)).toEqual([
      'var(--dbk-edge-color)',
      'var(--dbk-edge-mass-reduced)',
      'var(--dbk-edge-mass-critical)',
    ]);
  });

  it('updates the connection', () => {
    const { items, commands } = menu('member');
    pick(sub(items, 'Mass'), 'Critical');
    pick(sub(items, 'Time'), 'End of life');
    pick(sub(items, 'Bubbled'), 'Near Jita');
    pick(items, 'Dangerous');
    pick(items, 'Remove connection');
    expect(commands.updateConnection.mock.calls).toEqual([
      ['c1', { massStatus: 'critical' }],
      ['c1', { timeStatus: 'eol' }],
      ['c1', { bubbled: 'target' }],
      ['c1', { dangerous: true }],
    ]);
    expect(commands.removeConnection).toHaveBeenCalledWith('c1');
  });

  it('leaves out wormhole states on a gate, and everything for a viewer', () => {
    expect(rows(menu('member', { type: 'gate' }).items)).toEqual([
      'Bubbled',
      'Type',
      '—',
      'Dangerous',
      '—',
      'Remove connection',
    ]);
    expect(menu('viewer').items).toEqual([]);
  });
});

describe('pane menu', () => {
  it('adds a system for members; everyone can fit the chain and center on themselves', () => {
    const ctx = { onAddSystem: vi.fn(), onFitChain: vi.fn(), onCenterOnMe: vi.fn() };
    expect(rows(paneMenu({ ...ctx, can: mapPermissions('viewer') }))).toEqual(['Fit chain', 'Center on me']);
    const member = paneMenu({ ...ctx, can: mapPermissions('member') });
    expect(rows(member)).toEqual(['Add system here…', '—', 'Fit chain', 'Center on me']);
    pick(member, 'Fit chain');
    expect(ctx.onFitChain).toHaveBeenCalledOnce();
  });
});
