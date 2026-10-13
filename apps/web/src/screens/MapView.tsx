'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
  SYSTEM_PLACEMENT,
  type ConnectionDto,
  type LinkedMapDto,
  type MapDto,
  type MapSummaryDto,
  type StreamSnapshotDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { AlertTriangle, PanelRight, Plus, Radio, Waypoints, X } from 'lucide-react';
import { ContextMenu, type MenuItem } from '../components/ContextMenu';
import { setMapPeople, useMapPresence } from '../lib/presence';
import { mapPermissions } from '../lib/roles';
import { useMe } from '../lib/session';
import { track } from '../lib/telemetry';
import { useUniverseSystems } from '../lib/universe';
import { useMapSettings } from '../lib/useMapSettings';
import { usePageView } from '../lib/useTelemetry';
import { AddSystemSearch, type OnMapEntry } from '../map/AddSystemSearch';
import { OnlyTrackedGate, untrackedOf } from '../map/OnlyTrackedGate';
import { useMapIntel as useSystemIntel, useSetStanding, useStandingsQuery } from '../lib/intel';
import { MapCanvas, type FocusRequest, type MenuTarget } from '../map/MapCanvas';
import { useMapCharacters } from '../map/characters/useMapCharacters';
import type { HolderStanding } from '../map/menus/intel';
import { freeSpot } from '../map/geometry';
import { connectionMenu, paneMenu, statusOptions, systemMenu } from '../map/menus';
import { selectionMenu } from '../map/menus/selection';
import { keptText, planRemoval } from '../map/selection/removal';
import { count } from '../map/undo/labels';
import type { CanvasSelection } from '../map/MapCanvas';
import { useHubMenu } from '../map/routes/api';
import { ConnectionSidebar } from '../map/connection/ConnectionSidebar';
import { useConnectionIntel, useLivePassages, useMapIntel } from '../map/connection/data';
import { LogJumpDialog } from '../map/connection/LogJumpDialog';
import { RollingCalculator } from '../map/connection/RollingCalculator';
import type { ConnectionTraffic } from '../map/ConnectionEdge';
import { systemDisplayName } from '../map/SystemNode';
import { useMapStore } from '../map/useMapStore';
import { useUndoShortcut } from '../map/undo/useUndoShortcut';
import { useSignatureUndoBridge } from '../map/undo/signatureBridge';
import { useSystemsClipboard } from '../map/clipboard/useSystemsClipboard';
import { useCanvasPrefs } from '../map/canvas/prefs';
import { RallyCard } from '../map/pings/RallyCard';
import { useLinkedMaps } from '../map/linked/api';
import { LinkedMapPreview } from '../map/linked/LinkedMapPreview';
import { usePingCommands, usePings } from '../map/pings/api';
import { isWormholeSpace } from '../map/widgets/SystemDetails';
import { EditSystemDialog } from '../map/widgets/EditSystemDialog';
import { useBookmarkLabels } from '../map/useBookmarkLabels';
import { useMapPreferences } from '../map/useMapPreferences';
import { MapWidgets, type WidgetCover } from '../map/widgets/MapWidgets';
import { usePhone } from '../map/widgets/storage';
import { useWidgetsLayout } from '../map/widgets/useWidgetsLayout';
import { WidgetsMenu } from '../map/widgets/WidgetsMenu';
import { useViews } from '../map/views/useViews';
import { ViewSwitcher } from '../map/views/ViewSwitcher';
import { SignatureLayer } from '../map/signatures/SignatureLayer';
import { filterableSources, permissionsFor, withoutSources } from '../map/sharing/chain';
import { ProvenanceLine, provenanceText } from '../map/sharing/ProvenanceLine';
import { SourceFilter, useHiddenSources } from '../map/sharing/SourceFilter';
import { useSlot } from '../plugins/PluginSlot';
import { provideMapCounts } from '../lib/support';
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

/** The live map: canvas, search, the widgets, the connection panel, context menus. Browser only (React Flow). */
export function MapView({
  map,
  role,
  snapshot,
}: {
  map: MapDto;
  role: MapSummaryDto['role'];
  snapshot?: StreamSnapshotDto;
}) {
  // Undo labels name systems; the names arrive with the universe data, read when a label is made.
  const nameRef = useRef<(id: number) => string>(String);
  const store = useMapStore(map.id, snapshot, { nameOf: (id) => nameRef.current(id) });
  // On a map that merges others, a viewer may hide some of them (only in this browser).
  const sourceFilter = useHiddenSources(map.id);
  const state = useMemo(
    () => withoutSources(store.state, sourceFilter.hidden),
    [store.state, sourceFilter.hidden],
  );
  // A support ticket may include how big this map is (opt-in, counts only).
  const countsRef = useRef(state);
  useEffect(() => {
    countsRef.current = state;
  }, [state]);
  useEffect(() => {
    provideMapCounts(() => ({
      systems: countsRef.current.systems.size,
      connections: countsRef.current.connections.size,
      signatures: countsRef.current.signatures.size,
    }));
    return () => provideMapCounts(null);
  }, []);
  const me = useMe();
  const rf = useReactFlow();
  // Who else is here: cursors on the canvas, "N on this map" in the top bar.
  const presence = useMapPresence(`map:${map.id}`);
  const myId = me.data?.account.id;
  const peopleHere = presence.people.length + (presence.people.some((p) => p.accountId === myId) ? 0 : 1);
  const othersHere = presence.people
    .filter((p) => p.accountId !== myId)
    .map((p) => p.characterName ?? p.name)
    .join('\n');
  useEffect(() => {
    setMapPeople({ count: peopleHere, others: othersHere ? othersHere.split('\n') : [] });
  }, [peopleHere, othersHere]);
  useEffect(() => () => setMapPeople(null), []);
  const settings = useMapSettings();
  const toast = useToast();
  const can = mapPermissions(role);
  // The map's "only tracked characters" option: it opens once all of mine are tracked here.
  const untracked = untrackedOf(map, can, me.data?.characters ?? [], new Set(store.state.characters.keys()));
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
  // The connection panel belongs to a selected connection: shown with each newly selected one;
  // the top bar's toggle hides it while the selection stays.
  const [panel, setPanel] = useState(true);
  const [cover, setCover] = useState({ right: 0, bottom: 0 });
  const onCover = useCallback(
    (next: { right: number; bottom: number }) =>
      setCover((c) => (c.right === next.right && c.bottom === next.bottom ? c : next)),
    [],
  );
  // The widgets: always over the map, showing the selected system (Wanderer's windows).
  const widgets = useWidgetsLayout();
  const [widgetsShown, setWidgetsShown] = useState(true);
  const showWidgets = useCallback(() => setWidgetsShown(true), []);
  const [widgetCover, setWidgetCover] = useState<WidgetCover>({ right: 0, rightBottom: 0, bottom: 0 });
  const onWidgetCover = useCallback(
    (next: WidgetCover) =>
      setWidgetCover((c) =>
        c.right === next.right && c.rightBottom === next.rightBottom && c.bottom === next.bottom ? c : next,
      ),
    [],
  );
  // Edit system: the context menu's Edit…, a double-click on a system, System info's pencil.
  const [editing, setEditing] = useState<number | null>(null);
  const phone = usePhone();
  usePageView('map');
  useEffect(() => {
    if (widgetsShown && selected !== null) track('panel_opened', { panel: 'system' });
  }, [widgetsShown, selected]);
  useEffect(() => {
    if (panel && selectedConnection !== null) track('panel_opened', { panel: 'connections' });
  }, [panel, selectedConnection]);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [addAt, setAddAt] = useState<{ x: number; y: number } | null>(null);
  const [focus, setFocus] = useState({ search: 0 });
  const [focusNode, setFocusNode] = useState<FocusRequest | null>(null);
  const systemPlugins = useSlot('systemContextMenu', map.id);
  const connectionPlugins = useSlot('connectionContextMenu', map.id);
  const widgetPlugins = useSlot('widget', map.id);
  const hubMenu = useHubMenu(map.id, can.edit, toast);
  // Saved views: quick slots 1, 2, 3 and the Views menu, where the tracking button was.
  const views = useViews({
    mapId: map.id,
    views: (store.state.map ?? map).views,
    canPublish: can.manage,
    widgets,
    onApplied: showWidgets,
  });
  // My characters on this map: the top bar's strip, follow mode, On the map; tracking is in settings.
  const characters = useMapCharacters({
    map,
    can,
    state: store.state,
    select: (id) => select(id, true),
    openTracking: () => settings.show('tracking'),
    views: <ViewSwitcher views={views} compact={phone} />,
  });

  // Tags (`labels` in the data) and Labels (WH1...) of the map.
  const labels = (state.map ?? map).labels;
  const shownMap = state.map ?? map;
  const systemLabels = useMemo(() => shownMap.systemLabels ?? [], [shownMap]);
  const ids = useMemo(() => [...state.systems.keys()], [state.systems]);
  const universe = useUniverseSystems(ids);
  // The bookmark label of the system in Edit system, for its preview (worked out only while open).
  const { preferences } = useMapPreferences(map.id);
  const bookmarks = useBookmarkLabels({
    state,
    universe,
    systemLabels,
    preferences,
    enabled: editing !== null,
  });
  const onMap = useMemo(() => new Set(ids), [ids]);
  const system = selected !== null ? state.systems.get(selected) : undefined;
  const connection = selectedConnection !== null ? state.connections.get(selectedConnection) : undefined;
  const endName = (id: number) => {
    const sys = state.systems.get(id);
    return sys ? systemDisplayName(sys, universe.get(id)) : (universe.get(id)?.name ?? 'Unknown system');
  };
  useEffect(() => {
    nameRef.current = endName;
  });
  // The search finds systems on the map by their other names, Labels and Tags too.
  const searchEntries = useMemo((): OnMapEntry[] => {
    const labelName = new Map(systemLabels.map((l) => [l.id, l.name]));
    const tagName = new Map(labels.map((t) => [t.id, t.name]));
    return [...state.systems.values()].map((s) => {
      const info = universe.get(s.solarSystemId);
      const aliases: Array<{ text: string; what: string }> = [];
      const name = systemDisplayName(s, info);
      if (info && name !== info.name) aliases.push({ text: info.name, what: 'real name' });
      if (s.temporaryName) aliases.push({ text: s.temporaryName, what: 'temp name' });
      if (s.tag) aliases.push({ text: s.tag, what: 'tag' });
      if (s.customLabel) aliases.push({ text: s.customLabel, what: 'label' });
      for (const id of s.systemLabelIds) {
        const name = labelName.get(id);
        if (name) aliases.push({ text: name, what: 'label' });
      }
      for (const id of s.labelIds) {
        const name = tagName.get(id);
        if (name) aliases.push({ text: name, what: 'tag' });
      }
      return { id: s.solarSystemId, name, info, aliases };
    });
  }, [state.systems, universe, systemLabels, labels]);
  // Undo reverts this map's own history; a map that merges others writes to its sources'.
  const canUndo = can.edit && map.kind !== 'composite';
  const undo = useUndoShortcut(store.undo, toast, canUndo);
  // One stack for Ctrl+Z: removed signatures join it while they can be put back.
  useSignatureUndoBridge(map.id, store, endName);

  const closeMenu = useCallback(() => setMenu(null), []);
  const panelCover = connection && !system && panel ? cover : { right: 0, bottom: 0 };
  // On phones the connection's sheet takes the bottom; the widgets' dock steps aside meanwhile.
  const widgetsOn = widgetsShown && !(phone && connection && !system && panel);
  const covered = {
    right: panelCover.right,
    bottom: Math.max(panelCover.bottom, widgetsOn ? widgetCover.bottom : 0),
  };
  // The canvas also keeps the chain clear of the column of widget windows on the right.
  const canvasCover = {
    right: Math.max(covered.right, widgetsOn ? widgetCover.right : 0),
    // The column reaches this far down; a panel on the right covers the whole height.
    rightBottom: covered.right > 0 || !widgetsOn ? Infinity : widgetCover.rightBottom,
    bottom: covered.bottom,
  };

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

  // "Also on <map>": the other maps the system is on, asked when its menu opens.
  const linked = useLinkedMaps(
    map.id,
    menu?.target.kind === 'system' && map.kind !== 'composite' ? menu.target.solarSystemId : null,
  );
  const [preview, setPreview] = useState<{ linked: LinkedMapDto; solarSystemId: number } | null>(null);

  // The map's rally ping: a card in a corner, the system drawn as a rally, a route there.
  const prefs = useCanvasPrefs();
  const myAccount = me.data?.account.id;
  const myCharacters = useMemo(() => new Set(me.data?.characters.map((c) => c.id)), [me.data]);
  /** Where the viewer's own character is on the map: the main first, else any one online. */
  const myLocation = (() => {
    const own = [...state.characters.values()].filter(
      (c) =>
        (c.accountId === myAccount || myCharacters.has(c.characterId)) &&
        c.online &&
        c.solarSystemId !== null &&
        state.systems.has(c.solarSystemId),
    );
    const main = me.data?.account.mainCharacterId;
    return (own.find((c) => c.characterId === main) ?? own[0])?.solarSystemId ?? null;
  })();
  const { pings, pinged } = usePings(map.id, (ping) => {
    if (ping.createdBy === myAccount) return;
    toast({
      title: `Rally in ${endName(ping.solarSystemId)}`,
      description: `${ping.characterName ?? ping.createdByName ?? 'Someone'}${ping.message ? `: ${ping.message}` : ''}`,
      tone: 'warning',
      duration: 6000,
    });
  });
  const rally = pings.at(-1);
  const pingCommands = usePingCommands(map.id, toast);

  // "Select the system you jump into": a jump of one of the viewer's characters selects where it lands.
  const lastSeen = useRef(new Map<number, number | null>());
  useEffect(() => {
    const seen = lastSeen.current;
    for (const c of state.characters.values()) {
      if (!(c.accountId === myAccount || myCharacters.has(c.characterId))) continue;
      const before = seen.get(c.characterId);
      seen.set(c.characterId, c.solarSystemId);
      if (
        prefs.selectOnJump &&
        before !== undefined &&
        c.solarSystemId !== null &&
        before !== c.solarSystemId &&
        state.systems.has(c.solarSystemId)
      )
        select(c.solarSystemId, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when characters move
  }, [state.characters, prefs.selectOnJump, myAccount, myCharacters]);

  /** Delete on a selection, or "Remove" in its menu: what may go goes, in one gesture. */
  const removeSelection = (selected: CanvasSelection) => {
    const plan = planRemoval(selected, state, can, pinged);
    const kept = keptText(plan, endName);
    const label =
      plan.systems.length === 1 && plan.connections.length === 0
        ? `Removed ${endName(plan.systems[0]!)}`
        : plan.systems.length === 0
          ? `Removed ${count(plan.connections.length, 'connection')}`
          : `Removed ${count(plan.systems.length, 'system')}`;
    if (plan.systems.length + plan.connections.length > 0) {
      if (map.kind === 'composite')
        // A merged map writes through to its sources one change at a time.
        void store.gesture(label, (g) =>
          Promise.all([
            ...plan.connections.map((id) => store.removeConnection(id, {}, g)),
            ...plan.systems.map((id) => store.removeSystem(id, g)),
          ]),
        );
      else void store.removeMany({ systems: plan.systems, connections: plan.connections }, label);
      if (plan.systems.includes(selected.systems[0] ?? -1)) deselect();
    }
    if (kept)
      toast({
        title: plan.systems.length + plan.connections.length > 0 ? 'Some of it stays' : 'Nothing removed',
        description: kept,
        tone: 'warning',
      });
  };

  /** Applies one change to every system of a selection, as one gesture. */
  const updateSelection = (
    ids: readonly number[],
    patchOf: (
      system: NonNullable<ReturnType<typeof state.systems.get>>,
    ) => Parameters<typeof store.updateSystem>[1] | null,
    label: string,
  ) => {
    const patches = ids.flatMap((id) => {
      const sys = state.systems.get(id);
      const patch = sys ? patchOf(sys) : null;
      return patch ? [{ solarSystemId: id, patch }] : [];
    });
    if (map.kind === 'composite')
      void store.gesture(label, (g) =>
        Promise.all(patches.map((p) => store.updateSystem(p.solarSystemId, p.patch, g))),
      );
    else void store.updateMany(patches, label);
  };

  // Copy and paste of systems: at the pointer, else the middle of the visible canvas.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const clipboard = useSystemsClipboard({
    map: state.map ?? map,
    role,
    state,
    systemLabels,
    tags: labels,
    store,
    toast,
    editable: map.kind !== 'composite',
    selected: () =>
      rf
        .getNodes()
        .filter((n) => n.selected)
        .map((n) => Number(n.id)),
    pasteAt: () => pointer.current ?? defaultPosition(),
  });
  const copySelection = (ids: readonly number[]) => clipboard.copy(ids);

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
          onEdit: () => setEditing(sys.solarSystemId),
          plugins: systemPlugins,
          characters: me.data?.characters,
          notify: toast,
          onManageLabels: () => settings.show('labels'),
          routes: hubMenu,
          onManageTags: () => settings.show('tags'),
          ...holderOf(sys.solarSystemId),
          info: universe.get(sys.solarSystemId),
          dotlan: prefs.dotlan,
          linked: {
            maps: linked.data,
            open: (other) => setPreview({ linked: other, solarSystemId: sys.solarSystemId }),
          },
          ...(map.kind === 'composite'
            ? {}
            : {
                rally: {
                  ping: rally,
                  onCall: (message: string) =>
                    void pingCommands.call({ solarSystemId: sys.solarSystemId, message }),
                  onCancel: (pingId: string) => void pingCommands.cancel(pingId),
                },
              }),
        }),
      };
    }
    if (target.kind === 'selection') {
      const systems = target.selection.systems.flatMap((id) => state.systems.get(id) ?? []);
      if (systems.length === 0) return null;
      const ids = systems.map((s) => s.solarSystemId);
      const n = count(systems.length, 'system');
      const plan = planRemoval(target.selection, state, can, pinged);
      return {
        title: target.selection.connections.length
          ? `${n}, ${count(target.selection.connections.length, 'connection')}`
          : n,
        items: selectionMenu({
          systems,
          connections: plan.connections.length,
          can: map.kind === 'composite' ? { ...can, manage: false } : can,
          statusOptions,
          systemLabels,
          tags: labels,
          removable: plan.systems.length,
          onStatus: (status) =>
            updateSelection(
              ids,
              (s) => (s.status === status ? null : { status }),
              `Changed the status of ${n}`,
            ),
          onLabel: (labelId, on) =>
            updateSelection(
              ids,
              (s) =>
                s.systemLabelIds.includes(labelId) === on
                  ? null
                  : {
                      systemLabelIds: on
                        ? [...s.systemLabelIds, labelId]
                        : s.systemLabelIds.filter((l) => l !== labelId),
                    },
              `Changed the labels of ${n}`,
            ),
          onTag: (tagId, on) =>
            updateSelection(
              ids,
              (s) =>
                s.labelIds.includes(tagId) === on
                  ? null
                  : { labelIds: on ? [...s.labelIds, tagId] : s.labelIds.filter((l) => l !== tagId) },
              `Changed the tags of ${n}`,
            ),
          onLock: (locked) =>
            updateSelection(
              ids,
              (s) => (s.locked === locked ? null : { locked }),
              `${locked ? 'Locked' : 'Unlocked'} ${n}`,
            ),
          ...(clipboard.canCopy ? { onCopy: () => copySelection(ids) } : {}),
          onRemove: () => removeSelection(target.selection),
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
        undoLabel: canUndo ? store.undoLabel : null,
        onUndo: undo,
        ...(clipboard.canPaste ? { onPaste: () => void clipboard.pasteFromClipboard(target.flow) } : {}),
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
      x: bounds.left + (bounds.width - canvasCover.right) / 2,
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
        onDeleteSelection={removeSelection}
        onPointerAt={(p) => {
          pointer.current = p;
        }}
        rallies={pinged}
        presence={presence}
        coveredRight={canvasCover.right}
        coveredRightBottom={canvasCover.rightBottom}
        onEditSystem={(id) => {
          const sys = state.systems.get(id);
          if (sys && permissionsFor(can, sys.provenance, map.kind === 'composite').edit) setEditing(id);
        }}
        coveredBottom={covered.bottom}
      />

      <div className={styles.topbar}>
        <AddSystemSearch
          onMap={onMap}
          onPick={addSystem}
          entries={searchEntries}
          onFind={(id) => select(id, true)}
          canAdd={can.edit}
          focusToken={focus.search}
          placeholder={addAt ? 'Add a system at the pointer…' : undefined}
        />
        {store.pendingCount > 0 && (
          <span className={styles.saving} role="status">
            <Spinner label="Saving" />
            Saving…
          </span>
        )}
        <span className={styles.spacer} />
        {characters.bar}
        <SourceFilter
          sources={filterableSources(store.state.sources)}
          hidden={sourceFilter.hidden}
          onToggle={sourceFilter.toggle}
          className={styles.toolButton}
        />
        <WidgetsMenu
          controller={widgets}
          plugins={widgetPlugins}
          shown={widgetsShown}
          onShownChange={setWidgetsShown}
          className={styles.toolButton}
        />
        {connection && !system && (
          <IconButton
            variant="secondary"
            className={styles.toolButton}
            label={panel ? 'Hide connection panel' : 'Show connection panel'}
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
                    <>
                      <Button
                        variant="primary"
                        icon={<Plus />}
                        onClick={() => setFocus((f) => ({ ...f, search: f.search + 1 }))}
                      >
                        Add a system
                      </Button>
                      <Button icon={<Radio />} onClick={() => settings.show('tracking')}>
                        Track a character
                      </Button>
                    </>
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
      {store.loaded && store.state.has.characters && untracked.length > 0 && (
        <OnlyTrackedGate map={map} can={can} untracked={untracked} />
      )}
      {store.streamError && (
        <div className={styles.streamError} role="alert">
          <AlertTriangle aria-hidden />
          {store.streamError}
        </div>
      )}

      <MapWidgets
        mapId={map.id}
        system={system}
        info={system ? universe.get(system.solarSystemId) : undefined}
        universe={universe}
        labels={labels}
        systemLabels={systemLabels}
        state={state}
        can={system ? permissionsFor(can, system.provenance, map.kind === 'composite') : can}
        store={store}
        myCharacters={me.data?.characters ?? []}
        plugins={widgetPlugins}
        controller={widgets}
        shown={widgetsOn}
        onEdit={setEditing}
        onSelectSystem={(id) => select(id, true)}
        onCover={onWidgetCover}
        note={system && <ProvenanceLine provenance={system.provenance} sources={state.sources} />}
      />

      <EditSystemDialog
        system={editing !== null ? state.systems.get(editing) : undefined}
        info={editing !== null ? universe.get(editing) : undefined}
        labels={labels}
        systemLabels={systemLabels}
        bookmark={editing !== null ? bookmarks.get(editing) : null}
        can={(() => {
          const sys = editing !== null ? state.systems.get(editing) : undefined;
          return sys ? permissionsFor(can, sys.provenance, map.kind === 'composite') : can;
        })()}
        store={store}
        onManageLabels={() => {
          setEditing(null);
          settings.show('labels');
        }}
        onManageTags={() => {
          setEditing(null);
          settings.show('tags');
        }}
        onClose={() => setEditing(null)}
      />

      <SignatureLayer mapId={map.id} state={state} universe={universe} store={store} canEdit={can.edit} />
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

      {rally && state.systems.has(rally.solarSystemId) && (
        <RallyCard
          mapId={map.id}
          ping={rally}
          name={endName(rally.solarSystemId)}
          from={
            selected !== null && state.systems.has(selected)
              ? { solarSystemId: selected, name: endName(selected) }
              : myLocation !== null
                ? { solarSystemId: myLocation, name: endName(myLocation) }
                : null
          }
          corner={prefs.pings}
          canCancel={can.edit && map.kind !== 'composite'}
          characters={me.data?.characters}
          routable={!isWormholeSpace(universe.get(rally.solarSystemId))}
          notify={toast}
          onShow={() => select(rally.solarSystemId, true)}
          onSelectStep={(id) => (state.systems.has(id) ? select(id, true) : undefined)}
          onCancel={() => pingCommands.cancel(rally.id)}
        />
      )}

      {preview && (
        <LinkedMapPreview
          linked={preview.linked}
          solarSystemId={preview.solarSystemId}
          onClose={() => setPreview(null)}
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
