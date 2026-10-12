'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
  SYSTEM_PLACEMENT,
  type ConnectionDto,
  type MapDto,
  type MapSummaryDto,
  type StreamSnapshotDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { AlertTriangle, PanelRight, Plus, Waypoints, X } from 'lucide-react';
import { ContextMenu, type MenuItem } from '../components/ContextMenu';
import { mapPermissions } from '../lib/roles';
import { useMe } from '../lib/session';
import { track } from '../lib/telemetry';
import { useUniverseSystems } from '../lib/universe';
import { useMapSettings } from '../lib/useMapSettings';
import { usePageView } from '../lib/useTelemetry';
import { AddSystemSearch } from '../map/AddSystemSearch';
import { useMapIntel as useSystemIntel, useSetStanding, useStandingsQuery } from '../lib/intel';
import { MapCanvas, type FocusRequest, type MenuTarget } from '../map/MapCanvas';
import type { HolderStanding } from '../map/menus/intel';
import { freeSpot } from '../map/geometry';
import { connectionMenu, paneMenu, systemMenu } from '../map/menus';
import { ConnectionSidebar } from '../map/connection/ConnectionSidebar';
import { useConnectionIntel, useLivePassages, useMapIntel } from '../map/connection/data';
import { LogJumpDialog } from '../map/connection/LogJumpDialog';
import { RollingCalculator } from '../map/connection/RollingCalculator';
import type { ConnectionTraffic } from '../map/ConnectionEdge';
import { systemDisplayName } from '../map/SystemNode';
import { useMapStore } from '../map/useMapStore';
import { SystemSidebar } from '../map/sidebar/SystemSidebar';
import { filterableSources, permissionsFor, withoutSources } from '../map/sharing/chain';
import { ProvenanceLine, provenanceText } from '../map/sharing/ProvenanceLine';
import { SourceFilter, useHiddenSources } from '../map/sharing/SourceFilter';
import { useSlot } from '../plugins/PluginSlot';
import { Button, EmptyState, IconButton, Spinner, useToast } from '../ui';
import styles from './MapPage.module.css';

interface OpenMenu {
  target: MenuTarget;
  x: number;
  y: number;
}

type ConnectionDialog = { kind: 'log' | 'roll'; connectionId: string };

/** The rolling planner with the connection's intel (fetched, or shared with the open sidebar). */
function RollDialog({
  mapId,
  connectionId,
  merged,
  onClose,
}: {
  mapId: string;
  connectionId: string;
  merged: boolean;
  onClose(): void;
}) {
  const intel = useConnectionIntel(mapId, connectionId, merged);
  return (
    <RollingCalculator
      open
      onOpenChange={(open) => !open && onClose()}
      mapId={mapId}
      connectionId={connectionId}
      intel={intel.data}
    />
  );
}

function LogDialog({
  mapId,
  connection,
  names,
  merged,
  onClose,
}: {
  mapId: string;
  connection: ConnectionDto;
  names: { source: string; target: string };
  merged: boolean;
  onClose(): void;
}) {
  const intel = useConnectionIntel(mapId, connection.id, merged);
  return (
    <LogJumpDialog
      open
      onOpenChange={(open) => !open && onClose()}
      mapId={mapId}
      connection={connection}
      names={names}
      maxJumpMass={intel.data?.maxJumpMass ?? null}
    />
  );
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
  // On a map that merges others, a viewer may hide some of them (only in this browser).
  const sourceFilter = useHiddenSources(map.id);
  const state = useMemo(
    () => withoutSources(store.state, sourceFilter.hidden),
    [store.state, sourceFilter.hidden],
  );
  const me = useMe();
  const rf = useReactFlow();
  const settings = useMapSettings();
  const toast = useToast();
  const can = mapPermissions(role);
  const [selected, setSelected] = useState<number | null>(null);
  // A clicked connection takes the sidebar instead of a system.
  const [selectedConnection, setSelectedConnection] = useState<string | null>(null);
  const [connectionDialog, setConnectionDialog] = useState<ConnectionDialog | null>(null);
  const merged = !!state.sources;
  useLivePassages(map.id);
  const intel = useMapIntel(map.id);
  const traffic = useMemo(
    () =>
      new Map<string, ConnectionTraffic>(
        (intel.data ?? []).map((c) => [c.connectionId, { passages: c.mass.passages, passed: c.mass.passed }]),
      ),
    [intel.data],
  );
  // The sidebar belongs to the selection: hidden with nothing selected, shown with each newly
  // selected system; the top bar's toggle hides it while the selection stays.
  const [panel, setPanel] = useState(true);
  const [cover, setCover] = useState({ right: 0, bottom: 0 });
  const onCover = useCallback(
    (next: { right: number; bottom: number }) =>
      setCover((c) => (c.right === next.right && c.bottom === next.bottom ? c : next)),
    [],
  );
  usePageView('map');
  useEffect(() => {
    if (panel && selected !== null) track('panel_opened', { panel: 'system' });
  }, [panel, selected]);
  useEffect(() => {
    if (panel && selectedConnection !== null) track('panel_opened', { panel: 'connections' });
  }, [panel, selectedConnection]);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [addAt, setAddAt] = useState<{ x: number; y: number } | null>(null);
  const [focus, setFocus] = useState({ search: 0, name: 0 });
  const [focusNode, setFocusNode] = useState<FocusRequest | null>(null);
  const systemPlugins = useSlot('systemContextMenu', map.id);
  const connectionPlugins = useSlot('connectionContextMenu', map.id);
  const widgetPlugins = useSlot('widget', map.id);

  // Tags (`labels` in the data) and Labels (WH1...) of the map.
  const labels = (state.map ?? map).labels;
  const systemLabels = (state.map ?? map).systemLabels ?? [];
  const ids = useMemo(() => [...state.systems.keys()], [state.systems]);
  const universe = useUniverseSystems(ids);
  const onMap = useMemo(() => new Set(ids), [ids]);
  const system = selected !== null ? state.systems.get(selected) : undefined;
  const connection = selectedConnection !== null ? state.connections.get(selectedConnection) : undefined;
  const endName = (id: number) => {
    const sys = state.systems.get(id);
    return sys ? systemDisplayName(sys, universe.get(id)) : (universe.get(id)?.name ?? 'Unknown system');
  };

  const closeMenu = useCallback(() => setMenu(null), []);
  const covered = (system || connection) && panel ? cover : { right: 0, bottom: 0 };

  const select = (solarSystemId: number, center = false) => {
    setSelectedConnection(null);
    setSelected(solarSystemId);
    setPanel(true);
    setFocusNode((f) => ({ id: solarSystemId, center, n: (f?.n ?? 0) + 1 }));
  };

  // System intel for the system menu: who holds a system and how the viewer stands towards it.
  const systemIntel = useSystemIntel(map.id);
  const standings = useStandingsQuery();
  const setStanding = useSetStanding();
  const holderOf = (solarSystemId: number): { holder?: HolderStanding } => {
    const sov = systemIntel.systems.get(solarSystemId)?.sovereignty;
    if (sov?.kind !== 'alliance' || !standings.data) return {};
    const id = sov.holder.id;
    return {
      holder: {
        holder: sov.holder,
        standing: standings.data.standings.find((s) => s.id === id)?.standing ?? null,
        overridden: standings.data.overrides.includes(id),
        set: (standing) =>
          void setStanding(id, standing).catch(() =>
            toast({ title: 'Standing did not change', tone: 'danger' }),
          ),
      },
    };
  };

  const deselect = () => {
    setSelectedConnection(null);
    setFocusNode((f) => ({ id: null, center: false, n: (f?.n ?? 0) + 1 }));
  };

  // A right click only opens the menu: it does not select the system or open the panel.
  const openMenu = (target: MenuTarget, x: number, y: number) => setMenu({ target, x, y });

  // Built on every render, so toggles in an open menu show the current state.
  const menuContent = ((): { title?: string; note?: string; items: MenuItem[] } | null => {
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
          systemLabels,
          can: permissionsFor(can, sys.provenance, map.kind === 'composite'),
          store,
          plugins: systemPlugins,
          characters: me.data?.characters,
          notify: toast,
          onManageLabels: () => settings.show('labels'),
          onManageTags: () => settings.show('tags'),
          ...holderOf(sys.solarSystemId),
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
        // On a merged map: which maps hold it and whose change is the newest.
        ...(connection.provenance && state.sources
          ? { note: provenanceText(connection.provenance, state.sources) }
          : {}),
        items: connectionMenu({
          mapId: map.id,
          connection,
          names: { source: end(connection.source), target: end(connection.target) },
          can: permissionsFor(can, connection.provenance),
          store,
          plugins: connectionPlugins,
          onLogJump: () => setConnectionDialog({ kind: 'log', connectionId: connection.id }),
          onPlanRoll: () => setConnectionDialog({ kind: 'roll', connectionId: connection.id }),
        }),
      };
    }
    return {
      items: paneMenu({
        can,
        onAddSystem: () => {
          setAddAt(target.flow);
          setFocus((f) => ({ ...f, search: f.search + 1 }));
        },
        onFitChain: target.fitChain,
        onCenterOnMe: target.centerOnMe,
      }),
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
        systemLabels={systemLabels}
        universe={universe}
        can={can}
        store={store}
        onSelect={(id) => {
          if (id !== null && id !== selected) setPanel(true);
          if (id !== null) setSelectedConnection(null);
          setSelected(id);
        }}
        onSelectConnection={(id) => {
          if (id === null) return setSelectedConnection(null);
          if (id !== selectedConnection) setPanel(true);
          setSelected(null);
          setSelectedConnection(id);
        }}
        traffic={traffic}
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
        <SourceFilter
          sources={filterableSources(store.state.sources)}
          hidden={sourceFilter.hidden}
          onToggle={sourceFilter.toggle}
          className={styles.toolButton}
        />
        {(system || connection) && (
          <IconButton
            variant="secondary"
            className={styles.toolButton}
            label={
              connection
                ? panel
                  ? 'Hide connection panel'
                  : 'Show connection panel'
                : panel
                  ? 'Hide system panel'
                  : 'Show system panel'
            }
            aria-pressed={panel}
            icon={<PanelRight />}
            onClick={() => setPanel((p) => !p)}
          />
        )}
      </div>

      {store.loaded && state.systems.size === 0 && (
        <div className={styles.overlayCard}>
          <EmptyState
            icon={<Waypoints />}
            title="This map is empty"
            description={
              map.kind === 'composite'
                ? 'It shows the maps shared with it, merged into one chain. Accept their offers under Sharing.'
                : can.edit
                  ? 'Search for a system to start the chain, or track a character and the map follows as you jump.'
                  : 'Nobody has mapped anything here yet.'
            }
            actions={
              map.kind === 'composite'
                ? can.admin && (
                    <Button variant="primary" onClick={() => settings.show('sharing')}>
                      Open Sharing
                    </Button>
                  )
                : can.edit && (
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
          systemLabels={systemLabels}
          state={state}
          can={permissionsFor(can, system.provenance, map.kind === 'composite')}
          store={store}
          myCharacters={me.data?.characters ?? []}
          plugins={widgetPlugins}
          open={panel}
          focusToken={focus.name}
          onClose={deselect}
          onSelectSystem={(id) => select(id, true)}
          onCover={onCover}
          note={<ProvenanceLine provenance={system.provenance} sources={state.sources} />}
        />
      )}

      {connection && !system && (
        <ConnectionSidebar
          mapId={map.id}
          connection={connection}
          names={{ source: endName(connection.source), target: endName(connection.target) }}
          universe={universe}
          can={permissionsFor(can, connection.provenance)}
          store={store}
          merged={merged}
          open={panel}
          onClose={deselect}
          onSelectSystem={(id) => select(id, true)}
          onCover={onCover}
          onLogJump={() => setConnectionDialog({ kind: 'log', connectionId: connection.id })}
          onPlanRoll={() => setConnectionDialog({ kind: 'roll', connectionId: connection.id })}
          note={<ProvenanceLine provenance={connection.provenance} sources={state.sources} />}
        />
      )}

      {connectionDialog?.kind === 'roll' && (
        <RollDialog
          mapId={map.id}
          connectionId={connectionDialog.connectionId}
          merged={merged}
          onClose={() => setConnectionDialog(null)}
        />
      )}
      {connectionDialog?.kind === 'log' && state.connections.get(connectionDialog.connectionId) && (
        <LogDialog
          mapId={map.id}
          connection={state.connections.get(connectionDialog.connectionId)!}
          names={{
            source: endName(state.connections.get(connectionDialog.connectionId)!.source),
            target: endName(state.connections.get(connectionDialog.connectionId)!.target),
          }}
          merged={merged}
          onClose={() => setConnectionDialog(null)}
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
