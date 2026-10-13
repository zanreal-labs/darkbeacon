'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import { Menu as MenuIcon, Plus, X } from 'lucide-react';
import {
  routes,
  type CharacterDto,
  type HubRouteDto,
  type HubRoutesDto,
  type RoutesByEntryDto,
  type RoutesByKind,
  type RouteStepDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { ContextMenu, type MenuItem } from '../../components/ContextMenu';
import { api } from '../../lib/api';
import type { MapPermissions } from '../../lib/roles';
import { track } from '../../lib/telemetry';
import {
  Button,
  Checkbox,
  IconButton,
  Segmented,
  Select,
  SearchPicker,
  type PickerOption,
  useToast,
} from '../../ui';
import { hubMenu, stationsMenu, waypointMenu } from '../menus/routes';
import { WidgetWindow } from '../widgets/WidgetWindow';
import { readStored, writeStored } from '../widgets/storage';
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
}

/**
 * The Routes widget: from the selected system to every map hub, to the viewer's own hubs, or to
 * the nearest places of a kind (Wanderer's Routes, User Routes and Routes By in one window), each
 * with its jump count and the systems on the way. The three lists are small tabs in the title
 * bar and adding a hub is a button there, so the content is only rows: the map's five default
 * hubs fit without scrolling. Options live in its menu and follow the viewer.
 */
export function RoutesWidget(props: Props) {
  const { mapId, can } = props;
  const prefs = useRoutePreferences();
  const [tab, setTabState] = useState<Tab>(() =>
    typeof window === 'undefined' ? 'map' : (readStored(TAB_KEY, isTab) ?? 'map'),
  );
  const [adding, setAdding] = useState(false);
  const setTab = (next: Tab) => {
    setTabState(next);
    setAdding(false);
    writeStored(TAB_KEY, next);
  };
  const hubs = useHubs(mapId);
  const counts = { map: hubs.data?.map.length ?? 0, personal: hubs.data?.personal.length ?? 0 };
  const canAdd = tab === 'personal' || (tab === 'map' && can.edit);
  useEffect(() => {
    track('panel_opened', { panel: 'routes' });
  }, []);
  return (
    <WidgetWindow
      id="routes"
      title="Routes"
      tabs={
        <Segmented
          className={styles.tabs}
          aria-label="Routes to"
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          options={[
            { value: 'map', label: <TabLabel name="Map" count={counts.map} /> },
            { value: 'personal', label: <TabLabel name="Mine" count={counts.personal} /> },
            { value: 'by', label: 'Nearest' },
          ]}
        />
      }
      actions={
        <>
          {canAdd && (
            <IconButton
              size="sm"
              label={tab === 'map' ? 'Add a map hub' : 'Add a hub of mine'}
              tooltipSide="left"
              icon={<Plus />}
              aria-pressed={adding}
              onClick={() => setAdding((on) => !on)}
            />
          )}
          <RouteSettingsMenu
            preferences={prefs.preferences}
            characters={props.myCharacters}
            onChange={prefs.update}
          />
        </>
      }
    >
      <RoutesBody
        key={mapId}
        {...props}
        tab={tab}
        adding={adding && canAdd}
        onAddDone={() => setAdding(false)}
        preferences={prefs.preferences}
      />
    </WidgetWindow>
  );
}

/** "Map 5": a tab's name and, when it has any, how many hubs it lists. */
function TabLabel({ name, count }: { name: string; count: number }) {
  return (
    <>
      {name}
      {count > 0 && <span className={styles.tabCount}>{` ${count}`}</span>}
    </>
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
  tab,
  adding,
  onAddDone,
}: Props & {
  preferences: ReturnType<typeof useRoutePreferences>['preferences'];
  tab: Tab;
  /** The hub search is open (the title bar's + button). */
  adding: boolean;
  onAddDone(): void;
}) {
  const toast = useToast();
  const [kind, setKind] = useState<RoutesByKind>('blueLoot');
  const [highsec, setHighsec] = useState(false);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  useRouteRefresh(mapId);
  const hubs = useHubs(mapId);
  const toggleHub = useHubToggle(mapId, toast);
  const hubList = tab === 'by' ? 'map' : tab;
  const hubRoutes = useHubRoutes(mapId, solarSystemId, hubList, preferences, tab !== 'by');
  const by = useRoutesBy(mapId, solarSystemId, kind, highsec, preferences, tab === 'by');
  const optionsSet = optionsSummary(preferences) !== null;
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
              {by.data!.entries.map((entry) => {
                const onMenu = (e: MouseEvent) => openMenu({ ...entry, stations: entry.stations }, e);
                return (
                  <li key={entry.solarSystemId} className={styles.row} onContextMenu={onMenu}>
                    <NameButton id={entry.solarSystemId} name={entry.name} onMap={onMap} onSelect={select} />
                    <RouteStrip
                      steps={entry.steps}
                      onSelect={(s) => select(s.solarSystemId)}
                      onMenu={stepMenu}
                    />
                    <span className={styles.jumps}>{entry.jumps}</span>
                    <RowMenuButton onOpen={onMenu} />
                    {entry.stations.length > 0 && (
                      <span className={styles.stations} title={entry.stations.map((s) => s.name).join('\n')}>
                        {entry.stations[0]!.name}
                        {entry.stations.length > 1 ? ` and ${entry.stations.length - 1} more` : ''}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <>
          {adding && (
            <AddHub
              list={tab}
              limit={hubRoutes.data?.limit ?? 20}
              count={tab === 'map' ? counts.map : counts.personal}
              onAdd={(system) => {
                void toggleHub(tab, { solarSystemId: system.id, name: system.name }, true);
                onAddDone();
              }}
              onCancel={onAddDone}
            />
          )}
          {hubRoutes.isPending ? (
            <p className={styles.hint}>Finding routes…</p>
          ) : hubRoutes.isError ? (
            <p className={styles.hint}>Could not load the routes.</p>
          ) : (hubRoutes.data?.routes.length ?? 0) === 0 ? (
            <p className={styles.hint}>
              {tab === 'map'
                ? can.edit
                  ? 'No map hubs. Add one with +, or right-click a system › Map hub.'
                  : 'This map has no hubs yet.'
                : 'No hubs of yours (they show on every map). Add one with +, or right-click a system › My hub.'}
            </p>
          ) : hubRoutes.data!.routes.every((r) => r.jumps === null) ? (
            <Unreachable result={hubRoutes.data!} optionsSet={optionsSet} />
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

/** Why no hub can be reached from the selected system, as one line. */
export function unreachableText(reason: HubRoutesDto['unreachable'], optionsSet: boolean): string {
  switch (reason) {
    case 'isolated':
      return 'This system has no connections on the map, so no route leads to a hub.';
    case 'no-exit':
      return `No route out of this chain to k-space${optionsSet ? ' with these route options' : ''}.`;
    case 'options':
      return 'No route to any hub with these route options.';
    default:
      return 'No route to any of these hubs.';
  }
}

/** No hub reachable: one line saying why instead of a row per hub, then the hubs it is about. */
function Unreachable({ result, optionsSet }: { result: HubRoutesDto; optionsSet: boolean }) {
  return (
    <div className={styles.unreachable} role="status">
      <p className={styles.why}>{unreachableText(result.unreachable, optionsSet)}</p>
      <p className={styles.hubNames}>{result.routes.map((r) => r.name).join(' · ')}</p>
    </div>
  );
}

/** A row's actions: shown while the row is hovered or focused; a right-click opens them too. */
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

/** A hub: its name, the systems on the way as a strip, the jumps (a dash without a route). */
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
    <li className={styles.row} data-unreachable={route.jumps === null || undefined} onContextMenu={onMenu}>
      <NameButton
        id={route.solarSystemId}
        name={route.name}
        kind={route.kind === 'ping' ? 'ping' : undefined}
        onMap={onMap}
        onSelect={onSelect}
      />
      {route.jumps === null ? (
        <span />
      ) : route.jumps === 0 ? (
        <span className={styles.none}>here</span>
      ) : (
        <RouteStrip steps={route.steps} onSelect={(s) => onSelect(s.solarSystemId)} onMenu={onStepMenu} />
      )}
      {route.jumps === null ? (
        <span className={styles.jumps} title="No route">
          —
        </span>
      ) : (
        <span className={styles.jumps}>{route.jumps}</span>
      )}
      <RowMenuButton onOpen={onMenu} />
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
  onCancel,
}: {
  list: 'map' | 'personal';
  limit: number;
  count: number;
  onAdd(system: UniverseSystemDto): void;
  onCancel(): void;
}) {
  if (count >= limit) {
    return (
      <p className={styles.hint}>
        {list === 'map' ? 'The map' : 'You'} already {list === 'map' ? 'has' : 'have'} {limit} hubs, the most
        there can be. Remove one to add another.
      </p>
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
          if (picked) onAdd(picked.system);
        }}
      />
      <Button size="sm" variant="ghost" icon={<X />} aria-label="Cancel" onClick={onCancel} />
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
