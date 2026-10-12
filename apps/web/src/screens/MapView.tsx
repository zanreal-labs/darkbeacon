'use client';

import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useReactFlow } from '@xyflow/react';
import {
  SYSTEM_PLACEMENT,
  type MapDto,
  type MapSummaryDto,
  type StreamSnapshotDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { AlertTriangle, PanelRight, Plus, Settings, Waypoints, X } from 'lucide-react';
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
import { SystemSidebar } from '../map/sidebar/SystemSidebar';
import { useSlot } from '../plugins/PluginSlot';
import { Button, EmptyState, IconButton, Spinner } from '../ui';
import styles from './MapPage.module.css';

interface OpenMenu {
  target: MenuTarget;
  x: number;
  y: number;
}

/** The live map: canvas, search, the selected system's sidebar, context menus. Browser only (React Flow). */
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
  // The sidebar belongs to the selection: hidden with nothing selected, shown with each newly
  // selected system; the top bar's toggle hides it while the selection stays.
  const [panel, setPanel] = useState(true);
  const [cover, setCover] = useState({ right: 0, bottom: 0 });
  const onCover = useCallback(
    (next: { right: number; bottom: number }) =>
      setCover((c) => (c.right === next.right && c.bottom === next.bottom ? c : next)),
    [],
  );
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
  const covered = system && panel ? cover : { right: 0, bottom: 0 };

  const select = (solarSystemId: number, center = false) => {
    setSelected(solarSystemId);
    setPanel(true);
    setFocusNode((f) => ({ id: solarSystemId, center, n: (f?.n ?? 0) + 1 }));
  };

  const deselect = () => setFocusNode((f) => ({ id: null, center: false, n: (f?.n ?? 0) + 1 }));

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
            setPanel(true);
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
    return rf.screenToFlowPosition({
      x: bounds.left + (bounds.width - covered.right) / 2,
      y: bounds.top + (bounds.height - covered.bottom) / 2,
    });
  };

  return (
    <div
      className={styles.page}
      data-immersive
      style={
        {
          '--covered-right': `${covered.right}px`,
          '--covered-bottom': `${covered.bottom}px`,
        } as CSSProperties
      }
    >
      <MapCanvas
        mapId={map.id}
        state={state}
        loaded={store.loaded}
        labels={labels}
        universe={universe}
        can={can}
        store={store}
        onSelect={(id) => {
          if (id !== null && id !== selected) setPanel(true);
          setSelected(id);
        }}
        focus={focusNode}
        onMenu={openMenu}
        coveredRight={covered.right}
        coveredBottom={covered.bottom}
      />

      <div className={styles.topbar}>
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
        <span className={styles.spacer} />
        {system && (
          <IconButton
            variant="secondary"
            className={styles.toolButton}
            label={panel ? 'Hide system panel' : 'Show system panel'}
            aria-pressed={panel}
            icon={<PanelRight />}
            onClick={() => setPanel((p) => !p)}
          />
        )}
        {can.manage && (
          <IconButton
            asChild
            variant="secondary"
            className={styles.toolButton}
            label="Map settings"
            icon={<Settings />}
          >
            <Link href={`/m/${map.slug}/settings`} />
          </IconButton>
        )}
      </div>

      {store.loaded && state.systems.size === 0 && (
        <div className={styles.overlayCard}>
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

      {system && (
        <SystemSidebar
          mapId={map.id}
          system={system}
          info={universe.get(system.solarSystemId)}
          universe={universe}
          labels={labels}
          state={state}
          can={can}
          store={store}
          myCharacters={me.data?.characters ?? []}
          plugins={widgetPlugins}
          open={panel}
          focusToken={focus.name}
          onClose={deselect}
          onSelectSystem={(id) => select(id, true)}
          onCover={onCover}
        />
      )}

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
