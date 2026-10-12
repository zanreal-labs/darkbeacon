import { describe, expect, it, vi } from 'vitest';
import type { CharacterDto, LabelDto, MapRole, SystemLabelDto } from '@darkbeacon/shared';
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

const SYSTEM_LABELS: SystemLabelDto[] = [
  { id: 'wh1', name: 'WH1', description: '' },
  { id: 'wh2', name: 'WH2', description: 'Static to high-sec' },
];

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
    systemLabels: SYSTEM_LABELS,
    can: mapPermissions(role),
    store: commands,
    plugins: [],
    onManageLabels: () => {},
    onManageTags: () => {},
    ...more,
  });
  return { items, commands };
}

describe('system menu', () => {
  it('shows a viewer only what a viewer can do', () => {
    expect(rows(system('viewer').items)).toEqual(['Copy name']);
    const withPilot = system('viewer', {}, { characters: [pilot(1, 'Ayla Vex')] }).items;
    expect(rows(withPilot)).toEqual(['Set destination', 'Copy name']);
    expect(rows(sub(withPilot, 'Set destination'))).toEqual([
      'Set destination',
      'Add waypoint',
      'Add waypoint first',
    ]);
  });

  it('toggles map hubs for members and own hubs for everyone', () => {
    const toggle = vi.fn();
    const hubs = {
      trade: [],
      map: [{ solarSystemId: 31000005, name: 'J123456', security: -1, kind: 'map' as const, near: null }],
      personal: [],
    };
    const viewer = system('viewer', {}, { routes: { hubs, canEdit: false, toggle } }).items;
    expect(rows(viewer)).toEqual(['My hub', 'Copy name']);
    const member = system('member', {}, { routes: { hubs, canEdit: true, toggle } }).items;
    const mapHub = member.find((i) => i.kind === 'check' && i.label === 'Map hub');
    if (mapHub?.kind !== 'check') throw new Error('Map hub');
    expect(mapHub.checked).toBe(true);
    mapHub.onSelect();
    expect(toggle).toHaveBeenCalledWith('map', { solarSystemId: 31000005, name: 'J123456' }, false);
  });

  it('lets anyone set their own standing towards the holder, and go back to their contacts', () => {
    const set: Array<number | null> = [];
    const holder = (standing: number | null, overridden: boolean) => ({
      holder: { id: 1354830081, name: 'Goonswarm Federation', ticker: 'CONDI' },
      standing,
      overridden,
      set: (v: number | null) => void set.push(v),
    });
    const items = system('viewer', {}, { holder: holder(5, false) }).items;
    expect(rows(items)).toEqual(['Standing towards [CONDI]', 'Copy name']);
    const choices = sub(items, 'Standing towards [CONDI]');
    expect(rows(choices)).toEqual([
      'Excellent (+10)',
      'Good (+5)',
      'Neutral (0)',
      'Bad (-5)',
      'Terrible (-10)',
    ]);
    pick(choices, 'Terrible (-10)');
    const overridden = sub(
      system('viewer', {}, { holder: holder(-10, true) }).items,
      'Standing towards [CONDI]',
    );
    pick(overridden, 'Use my contacts again');
    expect(set).toEqual([-10, null]);
  });

  it('keeps the member top level short: details in submenus, remove last', () => {
    const { items } = system('member');
    expect(rows(items)).toEqual([
      'Status',
      'Labels',
      'Tags',
      'Rename',
      'Hide from routes',
      '—',
      'Copy name',
      '—',
      'Remove from map',
    ]);
    expect(items.filter((i) => i.kind !== 'separator').length).toBeLessThanOrEqual(8);
    expect(rows(sub(items, 'Labels'))).toEqual(['Custom label', '—', 'WH1', 'WH2 — Static to high-sec']);
    expect(rows(sub(items, 'Tags'))).toEqual(['Scouted', 'Rolling']);
  });

  it('gives managers Lock, "Manage labels…" and "Manage tags…" at the bottom of their submenus', () => {
    const { items } = system('manager');
    expect(rows(items)).toContain('Lock');
    expect(rows(sub(items, 'Labels'))).toEqual([
      'Custom label',
      '—',
      'WH1',
      'WH2 — Static to high-sec',
      '—',
      'Manage labels…',
    ]);
    expect(rows(sub(items, 'Tags'))).toEqual(['Scouted', 'Rolling', '—', 'Manage tags…']);
  });

  it('labels: the custom label first, toggles, Clear and Remove only when there is something', () => {
    const { items, commands } = system('member', { systemLabelIds: ['wh2'], customLabel: 'bait' });
    const labels = sub(items, 'Labels');
    expect(rows(labels)).toEqual([
      'Custom label',
      'Remove custom label',
      '—',
      'WH1',
      'WH2 — Static to high-sec',
      '—',
      'Clear',
    ]);
    // The submenu row names what is on.
    const row = items.find((i) => i.kind === 'submenu' && i.label === 'Labels');
    expect(row?.kind === 'submenu' && row.hint).toBe('WH2 bait');
    expect(labels.filter((i) => i.kind === 'check' && i.checked).map((i) => 'label' in i && i.label)).toEqual(
      ['WH2 — Static to high-sec'],
    );

    pick(labels, 'WH1');
    expect(commands.updateSystem).toHaveBeenLastCalledWith(31000005, { systemLabelIds: ['wh2', 'wh1'] });
    pick(labels, 'WH2 — Static to high-sec');
    expect(commands.updateSystem).toHaveBeenLastCalledWith(31000005, { systemLabelIds: [] });
    pick(labels, 'Clear');
    expect(commands.updateSystem).toHaveBeenLastCalledWith(31000005, { systemLabelIds: [] });
    pick(labels, 'Remove custom label');
    expect(commands.updateSystem).toHaveBeenLastCalledWith(31000005, { customLabel: null });

    const custom = labels[0]!;
    if (custom.kind !== 'input') throw new Error('no field');
    expect(custom).toMatchObject({ value: 'bait', maxLength: 16 });
    custom.onSubmit('scout');
    expect(commands.updateSystem).toHaveBeenLastCalledWith(31000005, { customLabel: 'scout' });
    custom.onSubmit('');
    expect(commands.updateSystem).toHaveBeenLastCalledWith(31000005, { customLabel: null });
  });

  it('a locked system offers Unlock and neither Remove nor Hide', () => {
    const r = rows(system('manager', { locked: true }).items);
    expect(r).toContain('Unlock');
    expect(r).not.toContain('Remove from map');
    expect(r).not.toContain('Hide from routes');
  });

  it('marks the current status and sets another; toggles tags', () => {
    const { items, commands } = system('member', { status: 'hostile' });
    const status = sub(items, 'Status');
    expect(status.filter((i) => i.kind === 'radio' && i.checked).map((i) => 'label' in i && i.label)).toEqual(
      ['Hostile'],
    );
    pick(status, 'Friendly');
    expect(commands.updateSystem).toHaveBeenCalledWith(31000005, { status: 'friendly' });

    const tags = sub(items, 'Tags');
    pick(tags, 'Scouted');
    pick(tags, 'Rolling');
    expect(commands.updateSystem).toHaveBeenCalledWith(31000005, { labelIds: [] });
    expect(commands.updateSystem).toHaveBeenCalledWith(31000005, { labelIds: ['l1', 'l2'] });
  });

  it('saves the name from its field, an empty field clears it; the old free-text tag is gone', () => {
    const { items, commands } = system('member', { tag: 'C3a' });
    const field = (label: string) => {
      const item = items.find((i) => i.kind === 'input' && i.label === label);
      if (item?.kind !== 'input') throw new Error(label);
      return item;
    };
    expect(items.some((i) => 'label' in i && i.label === 'Tag')).toBe(false);
    field('Rename').onSubmit('Home');
    field('Rename').onSubmit('');
    expect(commands.updateSystem).toHaveBeenCalledWith(31000005, { customName: 'Home' });
    expect(commands.updateSystem).toHaveBeenCalledWith(31000005, { customName: null });
  });

  it('routes several characters separately and leaves out those without the EVE grant', () => {
    const { items } = system(
      'member',
      {},
      {
        characters: [pilot(1, 'Ayla Vex'), pilot(2, 'Bren Tal'), pilot(3, 'No Scope', false)],
      },
    );
    expect(rows(sub(items, 'Set destination'))).toEqual(['All characters', '—', 'Ayla Vex', 'Bren Tal']);
    expect(rows(sub(sub(items, 'Set destination'), 'Bren Tal'))).toEqual([
      'Set destination',
      'Add waypoint',
      'Add waypoint first',
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
      'Lifetime left',
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
    expect(rows(sub(items, 'Lifetime left'))).toEqual([
      'Not marked',
      'Less than 1h',
      'Less than 4h',
      'Less than 4.5h',
      'Less than 16h',
      'Less than 24h',
      'Less than 48h',
    ]);
  });

  it('locks and unlocks for managers; a locked connection is read-only for members', () => {
    const { items } = menu('member');
    expect(rows(items)).not.toContain('Lock');
    const managed = menu('manager');
    expect(rows(managed.items)).toContain('Lock');
    pick(managed.items, 'Lock');
    expect(managed.commands.updateConnection.mock.calls).toEqual([['c1', { locked: true }]]);
    const locked = { locked: true };
    expect(rows(menu('member', locked).items)).not.toContain('Remove connection');
    expect(rows(menu('manager', locked).items)).toContain('Unlock');
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
