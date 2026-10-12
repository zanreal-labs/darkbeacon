import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import {
  buildPath,
  routes,
  type MapDto,
  type MapSummaryDto,
  type UniverseSystemDto,
} from '@wormwright/shared';
import { ContextMenu, type MenuItem } from '../components/ContextMenu';
import { Icon } from '../components/Icon';
import { api, ApiError } from '../lib/api';
import { useConnectionStatus } from '../lib/RealtimeProvider';
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
import { useBreadcrumbs } from '../shell/breadcrumbs';
import styles from './MapPage.module.css';

export function MapPage() {
  const { slug = '' } = useParams();
  const map = useQuery({
    queryKey: ['map', slug],
    queryFn: () => api<MapDto>(buildPath(routes.maps.bySlug.path, { slug })),
    retry: false,
  });
  const maps = useQuery({
    queryKey: ['maps'],
    queryFn: () => api<MapSummaryDto[]>(routes.maps.list.path),
    retry: false,
  });
  useBreadcrumbs([{ label: 'Maps', to: '/' }, { label: map.data?.name ?? slug }]);

  if (map.isPending) return <p className={styles.notice}>Loading map…</p>;
  if (map.isError) {
    const missing = map.error instanceof ApiError && map.error.status === 404;
    return (
      <p className={styles.notice}>
        {missing ? `There is no map “${slug}”, or you cannot see it.` : 'The map could not be loaded.'}{' '}
        <Link to="/">Back to maps</Link>
      </p>
    );
  }
  const role = maps.data?.find((m) => m.id === map.data.id)?.role ?? 'viewer';
  return (
    <ReactFlowProvider>
      <MapView key={map.data.id} map={map.data} role={role} />
    </ReactFlowProvider>
  );
}

interface OpenMenu {
  target: MenuTarget;
  x: number;
  y: number;
}

function MapView({ map, role }: { map: MapDto; role: MapSummaryDto['role'] }) {
  const store = useMapStore(map.id);
  const { state } = store;
  const me = useMe();
  const rf = useReactFlow();
  const can = mapPermissions(role);
  const status = useConnectionStatus();
  const [selected, setSelected] = useState<number | null>(null);
  const [dock, setDock] = useState(() => ({
    tab: 'system',
    open: typeof window !== 'undefined' && !window.matchMedia?.('(max-width: 760px)').matches,
  }));
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
      return {
        title: 'Connection',
        items: connectionMenu({ mapId: map.id, connection, can, store, plugins: connectionPlugins }),
      };
    }
    if (!can.edit) return null;
    return {
      items: [
        {
          kind: 'action',
          label: 'Add a system here…',
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
    if (system) return { x: system.position.x + 240, y: system.position.y };
    const bounds = document.querySelector('.react-flow')?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    const panel = dock.open && bounds.width > 760 ? 340 : 0;
    return rf.screenToFlowPosition({
      x: bounds.left + (bounds.width - panel) / 2,
      y: bounds.top + bounds.height / 2,
    });
  };

  const characters = [...state.characters.values()];
  const tabs: DockTab[] = [
    {
      id: 'system',
      title: 'System',
      icon: 'info',
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
          <p className="muted">Select a system on the map.</p>
        ),
    },
    {
      id: 'signatures',
      title: 'Signatures',
      icon: 'signal',
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
          <p className="muted">Select a system to see its signatures.</p>
        ),
    },
    {
      id: 'local',
      title: 'Local',
      icon: 'users',
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
      icon: 'puzzle',
      render: () => <SlotItem entry={entry} props={{ mapId: map.id }} />,
    })),
  ];

  return (
    <div className={styles.page}>
      <MapCanvas
        mapId={map.id}
        state={state}
        loaded={store.loaded}
        labels={labels}
        universe={universe}
        can={can}
        store={store}
        onSelect={setSelected}
        focus={focusNode}
        onMenu={openMenu}
        coveredRight={dock.open && wide ? 340 : 0}
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
        <div className={styles.status} data-status={status} role="status" title="Realtime connection">
          <span className={styles.dot} />
          {status === 'open'
            ? store.pendingCount > 0
              ? 'Saving…'
              : 'Live'
            : status === 'connecting'
              ? 'Connecting…'
              : 'Offline'}
        </div>
        {can.admin && (
          <Link to={`/m/${map.slug}/settings`} className="btn btn-small" aria-label="Map settings">
            <Icon name="settings" size={13} />
          </Link>
        )}
      </div>

      {store.loaded && state.systems.size === 0 && (
        <p className={styles.empty}>
          {can.edit
            ? 'This map is empty. Search for a system above, or track a character to map as you fly.'
            : 'This map is empty.'}
        </p>
      )}
      {store.streamError && <p className={styles.notice}>{store.streamError}</p>}

      <WidgetDock
        tabs={tabs}
        active={dock.tab}
        open={dock.open}
        onChange={(tab, open) => setDock({ tab, open })}
      />

      <ul className={styles.notices} aria-live="polite">
        {store.notices.map((n) => (
          <li key={n.id} className={styles.toast}>
            <span>{n.message}</span>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              aria-label="Dismiss"
              onClick={() => store.dismiss(n.id)}
            >
              <Icon name="close" size={12} />
            </button>
          </li>
        ))}
      </ul>

      {menu && menuContent && menuContent.items.length > 0 && (
        <ContextMenu x={menu.x} y={menu.y} {...menuContent} onClose={closeMenu} />
      )}
    </div>
  );
}
