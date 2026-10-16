'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ReactFlow,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type OnSelectionChangeParams,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  type LabelDto,
  type PresencePeerDto,
  type SystemLabelDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { holderStanding, useMapIntel, useRouteHubs, useStandings } from '../lib/intel';
import type { MapPermissions } from '../lib/roles';
import { useMe, useProviders } from '../lib/session';
import { track } from '../lib/telemetry';
import { useTheme } from '../theme/ThemeProvider';
import { useToast } from '../ui';
import { ConnectionEdge, type ConnectionEdgeType, type ConnectionTraffic } from './ConnectionEdge';
import type { PresencePublisher } from '../lib/presence';
import { CanvasMinimap } from './canvas/CanvasMinimap';
import { PresenceCursors } from './presence/PresenceCursors';
import { SNAP_GRID, useCanvasPrefs } from './canvas/prefs';
import { boundsOf, fitViewport, type Point, type Rect } from './geometry';
import { MapControls } from './MapControls';
import { DEFAULT_ZOOM, FIT_MIN_ZOOM, mapTypeVars } from './mapType';
import type { MapState } from './mapState';
import { exitChips } from './nodeFacts';
import { useViewerExits } from './routes/api';
import { SystemNode, systemDisplayName, type SystemNodeType } from './SystemNode';
import { useBookmarkLabels } from './useBookmarkLabels';
import { useMapPreferences } from './useMapPreferences';
import type { MapStore } from './useMapStore';
import styles from './MapCanvas.module.css';

const nodeTypes = { system: SystemNode };
const edgeTypes = { connection: ConnectionEdge };
const LONG_PRESS_MS = 500;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const FIT_MAX_ZOOM = 1;
/** A map never opens closer than this, whatever view was saved: the chain comes first. */
const OPEN_MAX_ZOOM = 1.1;
/** How long the view rests before it is saved for this account. */
const SAVE_VIEW_AFTER_MS = 800;

const LEGEND_KEY = 'dbk-map-legend';

function readStored<T>(key: string, valid: (v: unknown) => v is T): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return valid(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be blocked; the map works without it.
  }
}

const isViewport = (v: Viewport | null): v is Viewport =>
  v !== null &&
  ['x', 'y', 'zoom'].every((k) => Number.isFinite(v[k as keyof Viewport])) &&
  v.zoom >= MIN_ZOOM;

/** Keys typed into a field are not shortcuts. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/**
 * Moves the selection to a node once it is rendered (it may still be on its way from the store);
 * `id: null` clears the selection.
 */
export interface FocusRequest {
  id: number | null;
  center: boolean;
  n: number;
}

/** What is selected on the canvas: systems and connections. */
export interface CanvasSelection {
  systems: number[];
  connections: string[];
}

export type MenuTarget =
  | { kind: 'system'; solarSystemId: number }
  | { kind: 'selection'; selection: CanvasSelection }
  | { kind: 'connection'; connectionId: string }
  | { kind: 'pane'; flow: { x: number; y: number }; fitChain(): void; centerOnMe(): void };

interface Props {
  mapId: string;
  state: MapState;
  loaded: boolean;
  /** The map's Tags (`labels` in the data). */
  labels: LabelDto[];
  /** The map's Labels (WH1...). */
  systemLabels: SystemLabelDto[];
  universe: Map<number, UniverseSystemDto>;
  can: MapPermissions;
  store: Pick<MapStore, 'moveSystems' | 'addConnection'>;
  onSelect(solarSystemId: number | null): void;
  /** A connection was clicked (selected) or let go. */
  onSelectConnection?(connectionId: string | null): void;
  /** Passages and mass used per connection, for the hover card. */
  traffic?: ReadonlyMap<string, ConnectionTraffic>;
  focus: FocusRequest | null;
  onMenu(target: MenuTarget, x: number, y: number): void;
  /** Pixels on the right covered by the widget panel; views keep systems out from under it. */
  coveredRight?: number;
  /** How far down from the top the right-hand cover reaches (the widgets' column); all the way by default. */
  coveredRightBottom?: number;
  /** A double-click on a system: Edit system. */
  onEditSystem?(solarSystemId: number): void;
  /** Pixels at the bottom covered by the widget sheet (phones). */
  coveredBottom?: number;
  /**
   * A view without an account (public links): nothing moves, connects or opens a menu, no
   * preferences are read or saved, and the opening view does not look for the viewer's character.
   */
  readOnly?: boolean;
  /** The public link a read-only view comes through: intel is read through it. */
  publicToken?: string;
  /** Delete or Backspace with something selected. */
  onDeleteSelection?(selection: CanvasSelection): void;
  /** Where the mouse points on the map (map coordinates); null when it leaves the canvas. */
  onPointerAt?(point: Point | null): void;
  /** Systems with a rally ping: drawn as rally points. */
  rallies?: ReadonlySet<number>;
  /** Others on the map (their cursors are drawn) and where this tab shares its own. */
  presence?: { peers: readonly PresencePeerDto[]; publish: PresencePublisher };
  /** Read-only previews: systems and connections drawn as selected (the way in). */
  highlight?: { systems: ReadonlySet<number>; connections: ReadonlySet<string> };
  /** Read-only previews: the system the view opens on, instead of the whole chain. */
  openOn?: number;
}

/**
 * Where the map opens: the viewer's last view of it, else the whole chain when it fits at the
 * readable zoom, else their own location, else home, else the system changed last, at that zoom. The whole chain is never fitted on open
 * (chains get huge); "Fit chain" does that on demand.
 */
export function openingFocus({
  mine,
  home,
  latest,
}: {
  mine: number | null;
  home: number | null;
  latest: number | null;
}): number | null {
  return mine ?? home ?? latest;
}

export function MapCanvas({
  mapId,
  state,
  loaded,
  labels,
  systemLabels,
  universe,
  can,
  store,
  onSelect,
  onSelectConnection,
  traffic,
  focus,
  onMenu,
  coveredRight = 0,
  coveredRightBottom = Infinity,
  onEditSystem,
  coveredBottom = 0,
  readOnly = false,
  publicToken,
  onDeleteSelection,
  onPointerAt,
  rallies,
  presence,
  highlight,
  openOn,
}: Props) {
  const { theme } = useTheme();
  const demo = useProviders({ enabled: !readOnly }).data?.demo ?? false;
  const toast = useToast();
  const me = useMe({ enabled: !readOnly });
  const {
    preferences,
    settled,
    update: updatePreferences,
  } = useMapPreferences(mapId, { enabled: !readOnly });
  const editable = can.edit && !readOnly;
  // Public views draw the defaults: a visitor's browser settings are not asked for.
  const ownPrefs = useCanvasPrefs();
  const prefs = readOnly ? { ...ownPrefs, minimap: 'off' as const, dragSelects: false } : ownPrefs;
  // A right drag pans in the drag-to-select mode; its release must not open the pane menu.
  const rightDrag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const sharedSelection = useRef('null');
  const rf = useReactFlow<SystemNodeType, ConnectionEdgeType>();
  const [nodes, setNodes, onNodesChange] = useNodesState<SystemNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<ConnectionEdgeType>([]);
  const opened = useRef(false);
  const handledFocus = useRef(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  // A read-only view has intel only through its public link.
  const intel = useMapIntel(mapId, publicToken, !readOnly || publicToken !== undefined);
  const standings = useStandings(!readOnly);
  const routeHubs = useRouteHubs(mapId, !readOnly);
  // An exit's nearest-hub chip routes as the viewer's Routes widget does from that exit.
  const viewerExits = useViewerExits(mapId, !readOnly);
  const chips = useMemo(
    () => exitChips(viewerExits.data?.exits, state.exits, readOnly || viewerExits.isError),
    [viewerExits.data, viewerExits.isError, readOnly, state.exits],
  );

  // The viewer's own character on the map: their main first, then any other one that is online.
  const myLocation = useMemo(() => {
    const account = me.data?.account;
    if (!account) return null;
    const own = new Set(me.data?.characters.map((c) => c.id));
    const here = [...state.characters.values()].filter(
      (c) =>
        (c.accountId === account.id || own.has(c.characterId)) &&
        c.online &&
        c.solarSystemId !== null &&
        state.systems.has(c.solarSystemId),
    );
    const pick = here.find((c) => c.characterId === account.mainCharacterId) ?? here[0];
    return pick
      ? { characterId: pick.characterId, name: pick.name, solarSystemId: pick.solarSystemId! }
      : null;
  }, [me.data, state.characters, state.systems]);

  const bookmarks = useBookmarkLabels({ state, universe, systemLabels, preferences });

  // Store -> React Flow, keeping what React Flow owns: measurements, selection, a drag in progress.
  useEffect(() => {
    const here = new Map<number, number>();
    const pilotsHere = new Map<
      number,
      Array<{ id: number; name: string; ship: string | null; mine: boolean }>
    >();
    const own = new Set(me.data?.characters.map((c) => c.id));
    for (const c of state.characters.values()) {
      if (c.online && c.solarSystemId !== null) {
        here.set(c.solarSystemId, (here.get(c.solarSystemId) ?? 0) + 1);
        const list = pilotsHere.get(c.solarSystemId) ?? [];
        list.push({ id: c.characterId, name: c.name, ship: c.shipName, mine: own.has(c.characterId) });
        pilotsHere.set(c.solarSystemId, list);
      }
    }
    for (const list of pilotsHere.values())
      list.sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name));
    const hubs = chips;
    const tagById = new Map(labels.map((l) => [l.id, l]));
    setNodes((prev) => {
      const previous = new Map(prev.map((n) => [n.id, n]));
      return [...state.systems.values()].map((system): SystemNodeType => {
        const id = String(system.solarSystemId);
        const old = previous.get(id);
        const info = universe.get(system.solarSystemId);
        return {
          ...old,
          id,
          type: 'system',
          position: old?.dragging ? old.position : system.position,
          draggable: editable && !system.locked,
          className: rallies?.has(system.solarSystemId) ? styles.rally : undefined,
          ...(highlight ? { selected: highlight.systems.has(system.solarSystemId) } : {}),
          data: {
            mapId,
            system,
            info,
            // Labels in the map's order; Tags in the order they were set.
            systemLabels: systemLabels.filter((l) => system.systemLabelIds.includes(l.id)),
            tags: system.labelIds.flatMap((l) => tagById.get(l) ?? []),
            characters: here.get(system.solarSystemId) ?? 0,
            bookmark: bookmarks.get(system.solarSystemId) ?? null,
            hub: hubs.get(system.solarSystemId) ?? null,
            mine: myLocation?.solarSystemId === system.solarSystemId,
            intel: intel.systems.get(system.solarSystemId),
            standing: holderStanding(intel.systems.get(system.solarSystemId), standings),
            pulse: intel.pulses.has(system.solarSystemId),
            withAccount: !readOnly,
            pilots: pilotsHere.get(system.solarSystemId) ?? [],
            routeHub: routeHubs.map.has(system.solarSystemId)
              ? 'map'
              : routeHubs.personal.has(system.solarSystemId)
                ? 'personal'
                : null,
          },
        };
      });
    });
  }, [
    intel,
    standings,
    readOnly,
    routeHubs,
    me.data,
    state.systems,
    state.characters,
    chips,
    labels,
    systemLabels,
    universe,
    editable,
    mapId,
    setNodes,
    bookmarks,
    myLocation,
    rallies,
    highlight,
  ]);

  useEffect(() => {
    const name = (id: number) => {
      const system = state.systems.get(id);
      return system ? systemDisplayName(system, universe.get(id)) : undefined;
    };
    setEdges((prev) => {
      const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id));
      return [...state.connections.values()]
        .filter((c) => state.systems.has(c.source) && state.systems.has(c.target))
        .map((c) => ({
          id: c.id,
          type: 'connection',
          source: String(c.source),
          target: String(c.target),
          selected: highlight ? highlight.connections.has(c.id) : selected.has(c.id),
          data: {
            mapId,
            connection: c,
            sourceName: name(c.source),
            targetName: name(c.target),
            traffic: traffic?.get(c.id),
          },
        }));
    });
  }, [state.connections, state.systems, universe, mapId, setEdges, traffic, highlight]);

  /** Rectangles of the given nodes (all when omitted), as React Flow measured them. */
  const rectsOf = useCallback(
    (ids?: ReadonlySet<string>): Rect[] =>
      rf
        .getNodes()
        .filter((n) => !ids || ids.has(n.id))
        .map((n) => ({
          x: n.position.x,
          y: n.position.y,
          width: n.measured?.width ?? 230,
          height: n.measured?.height ?? 90,
        })),
    [rf],
  );

  /** The part of the canvas no panel covers. */
  const visibleBox = useCallback(() => {
    const box = canvasRef.current?.getBoundingClientRect();
    if (!box) return null;
    return { width: Math.max(1, box.width - coveredRight), height: Math.max(1, box.height - coveredBottom) };
  }, [coveredRight, coveredBottom]);

  /** Puts `point` (flow coordinates) in the middle of the visible canvas at `zoom`. */
  const centerOn = useCallback(
    (point: Point, zoom: number, animate: boolean) => {
      const box = visibleBox();
      if (!box) return;
      void rf.setViewport(
        { x: box.width / 2 - point.x * zoom, y: box.height / 2 - point.y * zoom, zoom },
        animate ? { duration: 250 } : undefined,
      );
    },
    [rf, visibleBox],
  );

  const centerOfSystem = useCallback(
    (solarSystemId: number): Point | null => {
      const rect = rectsOf(new Set([String(solarSystemId)]))[0];
      return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
    },
    [rectsOf],
  );

  // First view, once systems are measured and the saved view is known.
  useEffect(() => {
    if (readOnly || opened.current || !loaded || !settled || nodes.length === 0) return;
    if (!nodes.every((n) => n.measured?.width)) return; // runs again once React Flow measured them
    opened.current = true;
    if (isViewport(preferences.viewport)) {
      // Saved as the point in the middle of the view, so it fits a phone and a desktop alike. A
      // saved view that shows none of the map's systems (they were hidden, moved or imported since)
      // is not restored: the map opens as if nothing was saved.
      const { x, y, zoom } = preferences.viewport;
      const box = visibleBox();
      const at = Math.min(zoom, OPEN_MAX_ZOOM);
      const view = box && {
        x: x - box.width / 2 / at,
        y: y - box.height / 2 / at,
        width: box.width / at,
        height: box.height / at,
      };
      const showsSystems =
        !view ||
        rectsOf().some(
          (r) =>
            r.x < view.x + view.width &&
            r.x + r.width > view.x &&
            r.y < view.y + view.height &&
            r.y + r.height > view.y,
        );
      if (showsSystems) {
        centerOn({ x, y }, at, false);
        return;
      }
    }
    // A chain that fits on screen at the readable zoom opens centred as a whole.
    const bounds = boundsOf(rectsOf());
    const visible = visibleBox();
    if (
      bounds &&
      visible &&
      bounds.width * DEFAULT_ZOOM <= visible.width - 96 &&
      bounds.height * DEFAULT_ZOOM <= visible.height - 160
    ) {
      centerOn({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, DEFAULT_ZOOM, false);
      return;
    }
    const systems = [...state.systems.values()];
    const id = openingFocus({
      mine: myLocation?.solarSystemId ?? null,
      home: systems.find((s) => s.status === 'home')?.solarSystemId ?? null,
      latest:
        systems.reduce<(typeof systems)[number] | null>(
          (best, s) => (!best || s.updatedAt > best.updatedAt ? s : best),
          null,
        )?.solarSystemId ?? null,
    });
    const at = id !== null ? centerOfSystem(id) : null;
    if (at) centerOn(at, DEFAULT_ZOOM, false);
  }, [
    loaded,
    settled,
    nodes,
    rf,
    preferences.viewport,
    state.systems,
    myLocation,
    centerOfSystem,
    centerOn,
    readOnly,
    rectsOf,
    visibleBox,
  ]);

  const fitChain = useCallback(() => {
    const bounds = boundsOf(rectsOf());
    const box = canvasRef.current?.getBoundingClientRect();
    if (!bounds || !box) return;
    const phone = box.width < 760;
    const viewport = fitViewport(
      bounds,
      box,
      phone
        ? { top: 72, right: 16, bottom: 140 + coveredBottom, left: 16 }
        : { top: 80, right: coveredRight + 48, bottom: 56, left: 72 },
      { minZoom: FIT_MIN_ZOOM, maxZoom: FIT_MAX_ZOOM },
    );
    void rf.setViewport(viewport, { duration: 250 });
  }, [rf, rectsOf, coveredRight, coveredBottom]);

  // A public view has no saved view and no "me": visitors see the whole shared chain first.
  useEffect(() => {
    if (!readOnly || opened.current || !loaded || nodes.length === 0) return;
    if (!nodes.every((n) => n.measured?.width)) return;
    opened.current = true;
    // A preview opens on what it is about: the marked way, else its system, at a readable zoom.
    const marked =
      highlight && highlight.systems.size > 1
        ? boundsOf(rectsOf(new Set([...highlight.systems].map(String))))
        : null;
    const box = canvasRef.current?.getBoundingClientRect();
    if (marked && box) {
      void rf.setViewport(
        fitViewport(
          marked,
          box,
          { top: 48, right: 48, bottom: 48, left: 72 },
          { minZoom: FIT_MIN_ZOOM, maxZoom: DEFAULT_ZOOM },
        ),
      );
      return;
    }
    const at = openOn !== undefined ? centerOfSystem(openOn) : null;
    if (at) centerOn(at, DEFAULT_ZOOM, false);
    else fitChain();
  }, [readOnly, loaded, nodes, fitChain, openOn, centerOfSystem, centerOn, highlight, rectsOf, rf]);

  const centerOnMe = useCallback(() => {
    const at = myLocation ? centerOfSystem(myLocation.solarSystemId) : null;
    if (!at) {
      toast({
        title: 'None of your characters is on this map',
        description: 'Track a character and the map follows as you jump.',
        tone: 'info',
      });
      return;
    }
    centerOn(at, Math.max(rf.getZoom(), DEFAULT_ZOOM), true);
  }, [myLocation, centerOfSystem, centerOn, rf, toast]);

  // A panel that opens over the canvas must not hide the selected system, nor may a system picked
  // at the panel's edge stay under it: pan it into view (never while it is being dragged).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    const box = canvasRef.current?.getBoundingClientRect();
    const node = selectedId === null ? undefined : rf.getNode(selectedId);
    if (!box || !node || node.dragging || (coveredRight === 0 && coveredBottom === 0)) return;
    const { x, y, zoom } = rf.getViewport();
    const right = x + (node.position.x + (node.measured?.width ?? 230)) * zoom;
    const top = y + node.position.y * zoom;
    const bottom = y + (node.position.y + (node.measured?.height ?? 90)) * zoom;
    // The column on the right covers the system only if the system is beside it, not below it.
    const beside = top < coveredRightBottom + 8;
    const dx = beside ? Math.max(0, right - (box.width - coveredRight - 24)) : 0;
    const dy = Math.max(0, bottom - (box.height - coveredBottom - 24));
    if (dx > 0 || dy > 0) void rf.setViewport({ x: x - dx, y: y - dy, zoom }, { duration: 250 });
  }, [coveredRight, coveredRightBottom, coveredBottom, selectedId, rf]);

  // The same for a selected connection: its middle stays out from under the panel.
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  useEffect(() => {
    const box = canvasRef.current?.getBoundingClientRect();
    const edge = selectedEdge === null ? undefined : rf.getEdge(selectedEdge);
    const a = edge ? rf.getNode(edge.source) : undefined;
    const b = edge ? rf.getNode(edge.target) : undefined;
    if (!box || !a || !b || (coveredRight === 0 && coveredBottom === 0)) return;
    const { x, y, zoom } = rf.getViewport();
    const mid = (n: typeof a) => ({
      x: n.position.x + (n.measured?.width ?? 230) / 2,
      y: n.position.y + (n.measured?.height ?? 90) / 2,
    });
    const px = x + ((mid(a).x + mid(b).x) / 2) * zoom;
    const py = y + ((mid(a).y + mid(b).y) / 2) * zoom;
    const dx = Math.max(0, px - (box.width - coveredRight - 80));
    const dy = Math.max(0, py - (box.height - coveredBottom - 80));
    if (dx > 0 || dy > 0) void rf.setViewport({ x: x - dx, y: y - dy, zoom }, { duration: 250 });
  }, [coveredRight, coveredBottom, selectedEdge, rf]);

  const [legend, setLegendState] = useState(false);
  useEffect(() => {
    // After hydration: the server cannot know this browser's choice.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (readStored(LEGEND_KEY, (v): v is boolean => v === true)) setLegendState(true);
  }, []);
  const setLegend = useCallback((open: boolean) => {
    setLegendState(open);
    writeStored(LEGEND_KEY, open);
  }, []);

  /** The selection as React Flow holds it (pending connections left out). */
  const selection = useCallback(
    (): CanvasSelection => ({
      systems: rf
        .getNodes()
        .filter((n) => n.selected)
        .map((n) => Number(n.id)),
      connections: rf
        .getEdges()
        .filter((e) => e.selected && !e.id.startsWith('pending:'))
        .map((e) => e.id),
    }),
    [rf],
  );

  // F fits the chain, C centres on me, L toggles the legend, Delete removes the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const key = e.key.toLowerCase();
      if ((key === 'delete' || key === 'backspace') && editable && onDeleteSelection) {
        const selected = selection();
        if (selected.systems.length + selected.connections.length === 0) return;
        e.preventDefault();
        track('shortcut_used', { shortcut: 'delete_selection' });
        onDeleteSelection(selected);
        return;
      }
      if (key === 'f') fitChain();
      else if (key === 'c' && !readOnly) centerOnMe();
      else if (key === 'l') setLegend(!legend);
      else return;
      e.preventDefault();
      track('shortcut_used', {
        shortcut: key === 'f' ? 'fit_chain' : key === 'c' ? 'center_on_me' : 'legend',
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitChain, centerOnMe, setLegend, legend, readOnly, editable, onDeleteSelection, selection]);

  /** A system's menu, or the selection's when it is one of several selected systems. */
  const systemTarget = (id: number): MenuTarget => {
    const selected = selection();
    return selected.systems.length > 1 && selected.systems.includes(id)
      ? { kind: 'selection', selection: selected }
      : { kind: 'system', solarSystemId: id };
  };

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const saveViewport = (viewport: Viewport) => {
    // The demo account is shared by every visitor: one person's view must not become everyone's.
    if (readOnly || !opened.current || demo) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const box = visibleBox();
      if (!box) return;
      const rounded = {
        x: Math.round((box.width / 2 - viewport.x) / viewport.zoom),
        y: Math.round((box.height / 2 - viewport.y) / viewport.zoom),
        zoom: Math.round(viewport.zoom * 1000) / 1000,
      };
      updatePreferences({ viewport: rounded }).catch(() => {
        // Only a convenience: the next pan tries again.
      });
    }, SAVE_VIEW_AFTER_MS);
  };

  useEffect(() => {
    if (!focus || handledFocus.current === focus.n) return;
    if (focus.id === null) {
      handledFocus.current = focus.n;
      setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
      setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)));
      return;
    }
    const id = String(focus.id);
    const node = nodes.find((n) => n.id === id);
    if (!node) return; // not rendered yet; runs again when the nodes change
    handledFocus.current = focus.n;
    setNodes((ns) => ns.map((n) => (!!n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })));
    setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)));
    if (focus.center) {
      void rf.setCenter(
        node.position.x + (node.measured?.width ?? 230) / 2,
        node.position.y + (node.measured?.height ?? 90) / 2,
        { duration: 300, zoom: rf.getZoom() },
      );
    }
  }, [focus, nodes, rf, setNodes, setEdges]);

  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  // Touch has no right click: a long press opens the same context menu.
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse') {
      rightDrag.current = e.button === 2 ? { x: e.clientX, y: e.clientY, moved: false } : null;
      return;
    }
    if (readOnly) return;
    cancelPress();
    const target = e.target as Element;
    const { clientX: x, clientY: y } = e;
    press.current = {
      x,
      y,
      timer: setTimeout(() => {
        press.current = null;
        openMenuAt(target, x, y);
      }, LONG_PRESS_MS),
    };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10)
      cancelPress();
    const drag = rightDrag.current;
    if (drag && !drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
    if (e.pointerType === 'mouse' && (onPointerAt || presence)) {
      const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      onPointerAt?.(at);
      // Others see where this mouse points; the presence store keeps it to its rate.
      presence?.publish.cursor({ x: Math.round(at.x), y: Math.round(at.y) });
    }
  };

  const openMenuAt = (target: Element, x: number, y: number) => {
    const node = target.closest<HTMLElement>('.react-flow__node');
    if (node?.dataset.id) return onMenu(systemTarget(Number(node.dataset.id)), x, y);
    if (target.closest('.react-flow__nodesselection')) {
      const selected = selection();
      if (selected.systems.length > 0) return onMenu({ kind: 'selection', selection: selected }, x, y);
    }
    const edge = target.closest<SVGElement>('.react-flow__edge');
    if (edge?.dataset.id) return onMenu({ kind: 'connection', connectionId: edge.dataset.id }, x, y);
    if (target.closest('.react-flow__pane')) {
      onMenu({ kind: 'pane', flow: rf.screenToFlowPosition({ x, y }), fitChain, centerOnMe }, x, y);
    }
  };

  const onSelectionChange = ({ nodes: selected, edges: edgesSelected }: OnSelectionChangeParams) => {
    // React Flow reports the selection again on every render: share it only when it changed.
    const shared =
      selected.length + edgesSelected.length > 0
        ? {
            systems: selected.slice(0, 200).map((n) => Number(n.id)),
            connections: edgesSelected
              .filter((e) => !e.id.startsWith('pending:'))
              .slice(0, 200)
              .map((e) => e.id),
          }
        : null;
    const key = JSON.stringify(shared);
    if (presence && key !== sharedSelection.current) {
      sharedSelection.current = key;
      presence.publish.selection(shared);
    }
    setSelectedId(selected.length === 1 ? selected[0]!.id : null);
    // A click on a connection selects it alone; the sidebar then shows the connection.
    const edge = selected.length === 0 && edgesSelected.length === 1 ? edgesSelected[0]!.id : null;
    setSelectedEdge(edge);
    if (edge && !edge.startsWith('pending:')) {
      onSelectConnection?.(edge);
      return;
    }
    onSelectConnection?.(null);
    onSelect(selected.length === 1 ? Number(selected[0]!.id) : null);
  };

  return (
    <div
      ref={canvasRef}
      className={styles.canvas}
      data-soft={prefs.softBackground || undefined}
      style={mapTypeVars}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onPointerLeave={() => {
        onPointerAt?.(null);
        presence?.publish.cursor(null);
      }}
    >
      <ReactFlow<SystemNodeType, ConnectionEdgeType>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={onSelectionChange}
        onMoveEnd={(_, viewport) => saveViewport(viewport)}
        onNodeDragStop={(_, __, dragged) =>
          void store.moveSystems(
            dragged.map((n) => ({
              solarSystemId: Number(n.id),
              x: Math.round(n.position.x),
              y: Math.round(n.position.y),
            })),
          )
        }
        onConnect={({ source, target }) => {
          if (source !== target) void store.addConnection(Number(source), Number(target));
        }}
        onNodeDoubleClick={readOnly || !onEditSystem ? undefined : (_, node) => onEditSystem(Number(node.id))}
        onNodeContextMenu={
          readOnly
            ? undefined
            : (e, node) => {
                e.preventDefault();
                onMenu(systemTarget(Number(node.id)), e.clientX, e.clientY);
              }
        }
        onSelectionContextMenu={
          readOnly
            ? undefined
            : (e, picked) => {
                e.preventDefault();
                const selected = selection();
                if (picked.length === 0 && selected.systems.length === 0) return;
                onMenu({ kind: 'selection', selection: selected }, e.clientX, e.clientY);
              }
        }
        onEdgeContextMenu={
          readOnly
            ? undefined
            : (e, edge) => {
                e.preventDefault();
                onMenu({ kind: 'connection', connectionId: edge.id }, e.clientX, e.clientY);
              }
        }
        onPaneContextMenu={
          readOnly
            ? undefined
            : (e) => {
                e.preventDefault();
                // The end of a right-drag pan, not a click.
                if (rightDrag.current?.moved) return;
                const flow = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
                onMenu({ kind: 'pane', flow, fitChain, centerOnMe }, e.clientX, e.clientY);
              }
        }
        connectionMode={ConnectionMode.Loose}
        nodesConnectable={editable}
        nodesDraggable={editable}
        nodeDragThreshold={4}
        snapToGrid={prefs.snapToGrid}
        snapGrid={SNAP_GRID}
        // Pathfinder's way: a left drag selects, the right (or middle) button pans.
        {...(prefs.dragSelects
          ? { selectionOnDrag: true, panOnDrag: [1, 2], selectionMode: SelectionMode.Partial }
          : {})}
        // Dragging moves a system without selecting it: the panel opening mid-drag shifted the
        // view under the pointer and threw the system across the map.
        selectNodesOnDrag={false}
        // Double click is not a zoom: it jumped the view in close in the middle of work.
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        colorMode={theme.colorScheme}
        defaultViewport={{ x: 0, y: 0, zoom: DEFAULT_ZOOM }}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        proOptions={{ hideAttribution: true }}
      >
        {prefs.background !== 'none' && (
          <Background
            gap={24}
            variant={prefs.background === 'lines' ? BackgroundVariant.Lines : BackgroundVariant.Dots}
          />
        )}
        {prefs.minimap !== 'off' && <CanvasMinimap corner={prefs.minimap} />}
        {presence && <PresenceCursors peers={presence.peers} />}
        <MapControls
          mapId={mapId}
          can={can}
          onFit={fitChain}
          onCenterMe={centerOnMe}
          located={myLocation !== null}
          legend={legend}
          onLegend={setLegend}
          readOnly={readOnly}
        />
      </ReactFlow>
    </div>
  );
}
