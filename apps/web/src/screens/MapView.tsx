'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
  SYSTEM_PLACEMENT,
  type MapDto,
  type MapSummaryDto,
  type StreamSnapshotDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import {
  AlertTriangle,
  Info,
  MousePointerClick,
  Plus,
  Puzzle,
  Radar,
  UsersRound,
  Waypoints,
  X,
} from 'lucide-react';
import { ContextMenu, type MenuItem } from '../components/ContextMenu';
import { mapPermissions } from '../lib/roles';
import { useMe } from '../lib/session';
import { useUniverseSystems } from '../lib/universe';
import { AddSystemSearch } from '../map/AddSystemSearch';
import { MapCanvas, type FocusRequest, type MenuTarget } from '../map/MapCanvas';
import { freeSpot } from '../map/geometry';
import { connectionMenu, systemMenu } from '../map/menus';
import { systemDisplayName } from '../map/SystemNode';
import { useMapStore } from '../map/useMapStore';
import { LocalWidget } from '../map/widgets/LocalWidget';
import { SignaturesWidget } from '../map/widgets/SignaturesWidget';
import { SystemInfoWidget } from '../map/widgets/SystemInfoWidget';
import { WidgetDock, type DockTab } from '../map/widgets/WidgetDock';
import { SlotItem, useSlot } from '../plugins/PluginSlot';
import { Button, EmptyState, IconButton, Spinner } from '../ui';
import styles from './MapPage.module.css';

/** The phone dock's sheet at its tallest: 58 % of the screen above the 52 px tab bar. */
const sheetHeight = () => (typeof window === 'undefined' ? 0 : Math.round(window.innerHeight * 0.58) + 52);

interface OpenMenu {
  target: MenuTarget;
  x: number;
  y: number;
}

/** The live map: canvas, search, dock with widgets, context menus. Browser only (React Flow). */
export function MapView({
  map,
  role,
  snapshot,
}: {
  map: MapDto;
  role: MapSummaryDto['role'];
  snapshot?: StreamSnapshotDto;
}) {
  const store = useMapStore(map.id, snapshot);
  const { state } = store;
  const me = useMe();
  const rf = useReactFlow();
  const can = mapPermissions(role);
  const [selected, setSelected] = useState<number | null>(null);
  // The dock starts closed, so the first view has the whole width for the chain; on wide screens
  // the first selection opens it, unless the user already opened or closed it themselves.
  const [dock, setDock] = useState({ tab: 'system', open: false });
  const dockTouched = useRef(false);
  // Phones get the bottom dock, which covers nothing the view needs to avoid.
  const wide = typeof window !== 'undefined' && !window.matchMedia?.('(max-width: 760px)').matches;
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [addAt, setAddAt] = useState<{ x: number; y: number } | null>(null);
  const [focus, setFocus] = useState({ search: 0, name: 0 });
  const [focusNode, setFocusNode] = useState<FocusRequest | null>(null);
  const systemPlugins = useSlot('systemContextMenu', map.id);
  const connectionPlugins = useSlot('connectionContextMenu', map.id);
  const widgetPlugins = useSlot('widget', map.id);

  const labels = (state.map ?? map).labels;
  const ids = useMemo(() => [...state.systems.keys()], [state.systems]);
  const universe = useUniverseSystems(ids);
  const onMap = useMemo(() => new Set(ids), [ids]);
  const system = selected !== null ? state.systems.get(selected) : undefined;

  const closeMenu = useCallback(() => setMenu(null), []);

  const select = (solarSystemId: number, center = false) => {
    setSelected(solarSystemId);
    setFocusNode((f) => ({ id: solarSystemId, center, n: (f?.n ?? 0) + 1 }));
  };

  const openMenu = (target: MenuTarget, x: number, y: number) => {
    if (target.kind === 'system') select(target.solarSystemId);
    setMenu({ target, x, y });
  };

  // Built on every render, so toggles in an open menu show the current state.
  const menuContent = ((): { title?: string; items: MenuItem[] } | null => {
    if (!menu) return null;
    const { target } = menu;
    if (target.kind === 'system') {
      const sys = state.systems.get(target.solarSystemId);
      if (!sys) return null;
      const name = systemDisplayName(sys, universe.get(sys.solarSystemId));
      return {
        title: name,
        items: systemMenu({
          mapId: map.id,
          system: sys,
          name,
          labels,
          can,
          store,
          plugins: systemPlugins,
          onEdit: () => {
            setDock({ tab: 'system', open: true });
            setFocus((f) => ({ ...f, name: f.name + 1 }));
          },
        }),
      };
    }
    if (target.kind === 'connection') {
      const connection = state.connections.get(target.connectionId);
      if (!connection) return null;
      const end = (id: number) => {
        const sys = state.systems.get(id);
        return sys ? systemDisplayName(sys, universe.get(id)) : String(id);
      };
      return {
        title: `${end(connection.source)} ↔ ${end(connection.target)}`,
        items: connectionMenu({ mapId: map.id, connection, can, store, plugins: connectionPlugins }),
      };
    }
    if (!can.edit) return null;
    return {
      items: [
        {
          kind: 'action',
          label: 'Add a system here…',
          icon: <Plus />,
          onSelect: () => {
            setAddAt(target.flow);
            setFocus((f) => ({ ...f, search: f.search + 1 }));
          },
        },
      ],
    };
  })();

  const addSystem = (picked: UniverseSystemDto) => {
    if (onMap.has(picked.id)) return select(picked.id, true);
    const position = addAt ?? defaultPosition();
    setAddAt(null);
    void store.addSystem(
      picked.id,
      freeSpot(
        position,
        [...state.systems.values()].map((s) => s.position),
      ),
    );
    select(picked.id);
  };

  /** Next to the selected system, or in the middle of the visible canvas. */
  const defaultPosition = () => {
    if (system) return { x: system.position.x + SYSTEM_PLACEMENT.x, y: system.position.y };
    const bounds = document.querySelector('.react-flow')?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    const panel = dock.open && bounds.width > 760 ? 360 : 0;
    return rf.screenToFlowPosition({
      x: bounds.left + (bounds.width - panel) / 2,
      y: bounds.top + bounds.height / 2,
    });
  };

  const characters = [...state.characters.values()];
  const signatureCount = system
    ? [...state.signatures.values()].filter((s) => s.solarSystemId === system.solarSystemId).length
    : 0;
  const nothingSelected = (
    <EmptyState
      compact
      icon={<MousePointerClick />}
      title="No system selected"
      description="Click a system on the map to see its details. Right-click it for quick actions."
    />
  );
  const tabs: DockTab[] = [
    {
      id: 'system',
      title: 'System',
      icon: <Info />,
      render: () =>
        system ? (
          <SystemInfoWidget
            system={system}
            info={universe.get(system.solarSystemId)}
            labels={labels}
            can={can}
            store={store}
            focusToken={focus.name}
          />
        ) : (
          nothingSelected
        ),
    },
    {
      id: 'signatures',
      title: 'Signatures',
      icon: <Radar />,
      count: signatureCount,
      render: () =>
        system ? (
          <SignaturesWidget
            key={system.solarSystemId}
            mapId={map.id}
            solarSystemId={system.solarSystemId}
            signatures={[...state.signatures.values()].filter(
              (s) => s.solarSystemId === system.solarSystemId,
            )}
            streamed={state.has.signatures}
            can={can}
            store={store}
          />
        ) : (
          nothingSelected
        ),
    },
    {
      id: 'local',
      title: 'Local',
      icon: <UsersRound />,
      count: characters.filter((c) => c.online).length,
      render: () => (
        <LocalWidget
          mapId={map.id}
          selected={selected}
          characters={characters}
          universe={universe}
          myCharacters={me.data?.characters ?? []}
          can={can}
          store={store}
        />
      ),
    },
    ...widgetPlugins.map((entry): DockTab => ({
      id: entry.key,
      title: entry.title,
      icon: <Puzzle />,
      render: () => <SlotItem entry={entry} props={{ mapId: map.id }} />,
    })),
  ];

  return (
    <div className={styles.page} data-immersive>
      <MapCanvas
        mapId={map.id}
        state={state}
        loaded={store.loaded}
        labels={labels}
        universe={universe}
        can={can}
        store={store}
        onSelect={(id) => {
          setSelected(id);
          if (id !== null && wide && !dockTouched.current)
            setDock((d) => (d.open ? d : { ...d, open: true }));
        }}
        focus={focusNode}
        onMenu={openMenu}
        coveredRight={dock.open && wide ? 360 : 0}
        coveredBottom={dock.open && !wide ? sheetHeight() : 0}
      />

      <div className={styles.topbar} data-dock={dock.open && wide ? 'open' : undefined}>
        {can.edit && (
          <AddSystemSearch
            onMap={onMap}
            onPick={addSystem}
            focusToken={focus.search}
            placeholder={addAt ? 'Add a system at the pointer…' : undefined}
          />
        )}
        {store.pendingCount > 0 && (
          <span className={styles.saving} role="status">
            <Spinner label="Saving" />
            Saving…
          </span>
        )}
      </div>

      {store.loaded && state.systems.size === 0 && (
        <div className={styles.overlayCard} data-dock={dock.open && wide ? 'open' : undefined}>
          <EmptyState
            icon={<Waypoints />}
            title="This map is empty"
            description={
              can.edit
                ? 'Search for a system to start the chain, or track a character and the map follows as you jump.'
                : 'Nobody has mapped anything here yet.'
            }
            actions={
              can.edit && (
                <Button
                  variant="primary"
                  icon={<Plus />}
                  onClick={() => setFocus((f) => ({ ...f, search: f.search + 1 }))}
                >
                  Add a system
                </Button>
              )
            }
          />
        </div>
      )}
      {!store.loaded && (
        <div className={styles.center} role="status">
          <Spinner label="Loading systems" />
          <span>Loading systems…</span>
        </div>
      )}
      {store.streamError && (
        <div className={styles.streamError} role="alert">
          <AlertTriangle aria-hidden />
          {store.streamError}
        </div>
      )}

      <WidgetDock
        tabs={tabs}
        active={dock.tab}
        open={dock.open}
        onChange={(tab, open) => {
          dockTouched.current = true;
          setDock({ tab, open });
        }}
      />

      <ul className={styles.notices} aria-live="polite">
        {store.notices.map((n) => (
          <li key={n.id} className={styles.toast}>
            <AlertTriangle className={styles.toastIcon} aria-hidden />
            <span className={styles.toastText}>{n.message}</span>
            <IconButton
              size="sm"
              label="Dismiss"
              tooltip={false}
              icon={<X />}
              onClick={() => store.dismiss(n.id)}
            />
          </li>
        ))}
      </ul>

      {menu && menuContent && menuContent.items.length > 0 && (
        <ContextMenu x={menu.x} y={menu.y} {...menuContent} onClose={closeMenu} />
      )}
    </div>
  );
}
