'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import { Menu as MenuIcon, Plus, X } from 'lucide-react';
import {
  routes,
  type CharacterDto,
  type HubRouteDto,
  type RoutesByEntryDto,
  type RoutesByKind,
  type RouteStepDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { ContextMenu, type MenuItem } from '../../components/ContextMenu';
import { api } from '../../lib/api';
import type { MapPermissions } from '../../lib/roles';
import { track } from '../../lib/telemetry';
import { Button, Checkbox, Segmented, Select, SearchPicker, type PickerOption, useToast } from '../../ui';
import { hubMenu, stationsMenu, waypointMenu } from '../menus/routes';
import { SidebarSection } from '../sidebar/SidebarSection';
import { readStored, writeStored } from '../sidebar/storage';
import {
  useHubRoutes,
  useHubs,
  useHubToggle,
  useRoutePreferences,
  useRouteRefresh,
  useRoutesBy,
  useStations,
} from './api';
import { optionsSummary, RouteSettingsMenu } from './RouteSettingsMenu';
import { RouteStrip } from './RouteStrip';
import styles from './routes.module.css';

type Tab = 'map' | 'personal' | 'by';
const TAB_KEY = 'dbk-routes-tab';
const isTab = (v: unknown): v is Tab => v === 'map' || v === 'personal' || v === 'by';

const BY_KINDS: ReadonlyArray<{ value: RoutesByKind; label: string }> = [
  { value: 'blueLoot', label: 'Blue loot buyers' },
  { value: 'redLoot', label: 'Red loot buyers' },
  { value: 'securityOffice', label: 'Security offices' },
  { value: 'tradeHubs', label: 'Trade hubs' },
  { value: 'thera', label: 'Thera holes' },
  { value: 'turnur', label: 'Turnur holes' },
];

interface MenuTarget {
  solarSystemId: number;
  name: string;
  x: number;
  y: number;
  /** Stations already known (Routes By); otherwise they are loaded. */
  stations?: RoutesByEntryDto['stations'];
}

interface Props {
  mapId: string;
  /** The selected system: every route starts there. */
  solarSystemId: number;
  can: MapPermissions;
  myCharacters: readonly CharacterDto[];
  /** Systems on the map (a click on one of them selects and centres it). */
  onMap: ReadonlySet<number>;
  onSelectSystem(solarSystemId: number): void;
  collapsed: boolean;
  onToggle(id: string): void;
}

/**
 * The routes section of the system sidebar: from the selected system to every map hub, to the
 * viewer's own hubs, or to the nearest places of a kind (Routes By), each with its jump count
 * and the systems on the way. Options live in the section's menu and follow the viewer.
 */
export function RoutesSidebarSection(props: Props) {
  const { mapId, collapsed, onToggle } = props;
  const prefs = useRoutePreferences();
  useEffect(() => {
    if (!collapsed) track('panel_opened', { panel: 'routes' });
  }, [collapsed]);
  return (
    <SidebarSection
      id="routes"
      title="Routes"
      collapsed={collapsed}
      onToggle={onToggle}
      action={
        <RouteSettingsMenu
          preferences={prefs.preferences}
          characters={props.myCharacters}
          onChange={prefs.update}
        />
      }
    >
      <RoutesBody key={mapId} {...props} preferences={prefs.preferences} />
    </SidebarSection>
  );
}

function RoutesBody({
  mapId,
  solarSystemId,
  can,
  myCharacters,
  onMap,
  onSelectSystem,
  preferences,
}: Props & { preferences: ReturnType<typeof useRoutePreferences>['preferences'] }) {
  const toast = useToast();
  const [tab, setTabState] = useState<Tab>(() =>
    typeof window === 'undefined' ? 'map' : (readStored(TAB_KEY, isTab) ?? 'map'),
  );
  const setTab = (next: Tab) => {
    setTabState(next);
    writeStored(TAB_KEY, next);
  };
  const [kind, setKind] = useState<RoutesByKind>('blueLoot');
  const [highsec, setHighsec] = useState(false);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  useRouteRefresh(mapId);
  const hubs = useHubs(mapId);
  const toggleHub = useHubToggle(mapId, toast);
  const hubList = tab === 'by' ? 'map' : tab;
  const hubRoutes = useHubRoutes(mapId, solarSystemId, hubList, preferences, tab !== 'by');
  const by = useRoutesBy(mapId, solarSystemId, kind, highsec, preferences, tab === 'by');
  const summary = optionsSummary(preferences);
  const counts = { map: hubs.data?.map.length ?? 0, personal: hubs.data?.personal.length ?? 0 };

  const select = (id: number) => {
    if (onMap.has(id)) onSelectSystem(id);
  };
  const openMenu = (target: Omit<MenuTarget, 'x' | 'y'>, e: MouseEvent) => {
    e.preventDefault();
    setMenu({ ...target, x: e.clientX, y: e.clientY });
  };
  const stepMenu = (step: RouteStepDto, at: { x: number; y: number }) =>
    setMenu({ solarSystemId: step.solarSystemId, name: step.name, ...at });

  return (
    <div className={styles.routes}>
      <Segmented
        aria-label="Routes to"
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        options={[
          { value: 'map', label: counts.map > 0 ? `Map hubs ${counts.map}` : 'Map hubs' },
          { value: 'personal', label: counts.personal > 0 ? `My hubs ${counts.personal}` : 'My hubs' },
          { value: 'by', label: 'Nearest' },
        ]}
      />
      {summary && <p className={styles.options}>{summary}</p>}

      {tab === 'by' ? (
        <>
          <div className={styles.bar}>
            <Select
              size="sm"
              aria-label="Nearest what"
              value={kind}
              options={BY_KINDS}
              onValueChange={(v) => setKind(v as RoutesByKind)}
            />
            <Checkbox checked={highsec} onCheckedChange={(on) => setHighsec(on === true)} label="High-sec" />
          </div>
          {by.isPending ? (
            <p className={styles.hint}>Looking…</p>
          ) : by.isError ? (
            <p className={styles.hint}>Could not load these routes.</p>
          ) : (by.data?.entries.length ?? 0) === 0 ? (
            <p className={styles.hint}>
              {kind === 'thera' || kind === 'turnur'
                ? 'EVE-Scout lists no hole that a route can reach with these options.'
                : 'Nothing found within reach.'}
            </p>
          ) : (
            <ul className={styles.list} aria-label="Nearest places">
              {by.data!.entries.map((entry) => (
                <li key={entry.solarSystemId} className={styles.row}>
                  <RowMenuButton onOpen={(e) => openMenu({ ...entry, stations: entry.stations }, e)} />
                  <NameButton id={entry.solarSystemId} name={entry.name} onMap={onMap} onSelect={select} />
                  <span className={styles.jumps}>{entry.jumps}</span>
                  <RouteStrip
                    steps={entry.steps}
                    onSelect={(s) => select(s.solarSystemId)}
                    onMenu={stepMenu}
                  />
                  {entry.stations.length > 0 && (
                    <span className={styles.stations} title={entry.stations.map((s) => s.name).join('\n')}>
                      {entry.stations[0]!.name}
                      {entry.stations.length > 1 ? ` and ${entry.stations.length - 1} more` : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          {hubRoutes.isPending ? (
            <p className={styles.hint}>Finding routes…</p>
          ) : hubRoutes.isError ? (
            <p className={styles.hint}>Could not load the routes.</p>
          ) : (hubRoutes.data?.routes.length ?? 0) === 0 ? (
            <p className={styles.hint}>
              {tab === 'map'
                ? can.edit
                  ? 'No map hubs yet. Add one below, or right-click a system and pick Map hub.'
                  : 'This map has no hubs yet.'
                : 'Your own hubs show on every map. Add one below, or right-click a system and pick My hub.'}
            </p>
          ) : (
            <ul
              className={styles.list}
              aria-label={tab === 'map' ? 'Routes to map hubs' : 'Routes to my hubs'}
            >
              {hubRoutes.data!.routes.map((route) => (
                <HubRow
                  key={route.solarSystemId}
                  route={route}
                  onMap={onMap}
                  onSelect={select}
                  onMenu={(e) => openMenu(route, e)}
                  onStepMenu={stepMenu}
                />
              ))}
            </ul>
          )}
          {(tab === 'personal' || can.edit) && (
            <AddHub
              list={tab}
              limit={hubRoutes.data?.limit ?? 20}
              count={tab === 'map' ? counts.map : counts.personal}
              onAdd={(system) => void toggleHub(tab, { solarSystemId: system.id, name: system.name }, true)}
            />
          )}
        </>
      )}

      {menu && (
        <SystemRouteMenu
          target={menu}
          characters={myCharacters}
          hubs={hubs.data}
          canEdit={can.edit}
          onMap={onMap.has(menu.solarSystemId)}
          onShow={() => select(menu.solarSystemId)}
          onToggleHub={(list, on) => void toggleHub(list, menu, on)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function RowMenuButton({ onOpen }: { onOpen(e: MouseEvent): void }) {
  return (
    <button type="button" className={styles.rowMenu} aria-label="Route actions" onClick={onOpen}>
      <MenuIcon aria-hidden />
    </button>
  );
}

function NameButton({
  id,
  name,
  kind,
  onMap,
  onSelect,
}: {
  id: number;
  name: string;
  kind?: string;
  onMap: ReadonlySet<number>;
  onSelect(id: number): void;
}) {
  const here = onMap.has(id);
  return (
    <button
      type="button"
      className={styles.name}
      data-on-map={here || undefined}
      title={here ? `${name}: show on the map` : name}
      onClick={() => onSelect(id)}
    >
      {name}
      {kind && <span className={styles.kind}>{kind}</span>}
    </button>
  );
}

function HubRow({
  route,
  onMap,
  onSelect,
  onMenu,
  onStepMenu,
}: {
  route: HubRouteDto;
  onMap: ReadonlySet<number>;
  onSelect(id: number): void;
  onMenu(e: MouseEvent): void;
  onStepMenu(step: RouteStepDto, at: { x: number; y: number }): void;
}) {
  return (
    <li className={styles.row} onContextMenu={onMenu}>
      <RowMenuButton onOpen={onMenu} />
      <NameButton
        id={route.solarSystemId}
        name={route.name}
        kind={route.kind === 'ping' ? 'ping' : undefined}
        onMap={onMap}
        onSelect={onSelect}
      />
      <span className={styles.jumps}>{route.jumps ?? ''}</span>
      {route.jumps === null ? (
        <span className={styles.none}>No connection</span>
      ) : route.jumps === 0 ? (
        <span className={styles.none}>You are here</span>
      ) : (
        <RouteStrip steps={route.steps} onSelect={(s) => onSelect(s.solarSystemId)} onMenu={onStepMenu} />
      )}
    </li>
  );
}

interface SystemOption extends PickerOption {
  system: UniverseSystemDto;
}

function AddHub({
  list,
  limit,
  count,
  onAdd,
}: {
  list: 'map' | 'personal';
  limit: number;
  count: number;
  onAdd(system: UniverseSystemDto): void;
}) {
  const [open, setOpen] = useState(false);
  if (count >= limit) {
    return (
      <p className={styles.hint}>
        {list === 'map' ? 'The map' : 'You'} already {list === 'map' ? 'has' : 'have'} {limit} hubs, the most
        there can be. Remove one to add another.
      </p>
    );
  }
  if (!open) {
    return (
      <div className={styles.add}>
        <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setOpen(true)}>
          {list === 'map' ? 'Add a map hub' : 'Add a hub of mine'}
        </Button>
      </div>
    );
  }
  return (
    <div className={styles.add}>
      <SearchPicker<SystemOption>
        aria-label={list === 'map' ? 'Add a map hub' : 'Add a hub of mine'}
        placeholder="System name…"
        minLength={2}
        value={null}
        cacheKey={['hub-search']}
        empty="No system by that name"
        search={async (text) => {
          const found = await api<UniverseSystemDto[]>(
            `${routes.universe.searchSystems.path}?${new URLSearchParams({ q: text, limit: '8' })}`,
          );
          return {
            options: found.map((system) => ({
              key: String(system.id),
              label: system.name,
              detail: system.regionName,
              system,
            })),
          };
        }}
        onChange={(picked) => {
          if (!picked) return;
          onAdd(picked.system);
          setOpen(false);
        }}
      />
      <Button size="sm" variant="ghost" icon={<X />} aria-label="Cancel" onClick={() => setOpen(false)} />
    </div>
  );
}

/** The context menu of a route's system: set the route in game, its stations, hub toggles. */
function SystemRouteMenu({
  target,
  characters,
  hubs,
  canEdit,
  onMap,
  onShow,
  onToggleHub,
  onClose,
}: {
  target: MenuTarget;
  characters: readonly CharacterDto[];
  hubs: ReturnType<typeof useHubs>['data'];
  canEdit: boolean;
  onMap: boolean;
  onShow(): void;
  onToggleHub(list: 'map' | 'personal', on: boolean): void;
  onClose(): void;
}) {
  const toast = useToast();
  const loaded = useStations(target.stations ? null : target.solarSystemId);
  const stations = target.stations ?? loaded.data;
  const system = { solarSystemId: target.solarSystemId, name: target.name };
  const items: MenuItem[] = [
    ...waypointMenu(characters, system, toast),
    ...stationsMenu(characters, system, stations, toast),
  ];
  const hubItems = hubMenu({ hubs, canEdit, toggle: (list, _hub, on) => onToggleHub(list, on) }, system);
  if (hubItems.length > 0) items.push({ kind: 'separator' }, ...hubItems);
  if (onMap)
    items.push({ kind: 'separator' }, { kind: 'action', label: 'Show on the map', onSelect: onShow });
  if (items.length === 0) items.push({ kind: 'label', label: 'Nothing to do here' });
  return <ContextMenu x={target.x} y={target.y} title={target.name} items={items} onClose={onClose} />;
}
