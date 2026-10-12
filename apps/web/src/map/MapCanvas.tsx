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
  ConnectionMode,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type OnSelectionChangeParams,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  bookmarkChain,
  bookmarkClassLabel,
  bookmarkLabel,
  DEFAULT_BOOKMARK_TEMPLATE,
  type LabelDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import type { MapPermissions } from '../lib/roles';
import { useMe } from '../lib/session';
import { track } from '../lib/telemetry';
import { useTheme } from '../theme/ThemeProvider';
import { useToast } from '../ui';
import { ConnectionEdge, type ConnectionEdgeType, type ConnectionTraffic } from './ConnectionEdge';
import { boundsOf, fitViewport, type Point, type Rect } from './geometry';
import { MapControls } from './MapControls';
import { DEFAULT_ZOOM, FIT_MIN_ZOOM, mapTypeVars } from './mapType';
import type { MapState } from './mapState';
import { exitHubs } from './nodeFacts';
import { SystemNode, systemDisplayName, type SystemNodeType } from './SystemNode';
import { useMapPreferences } from './useMapPreferences';
import type { MapStore } from './useMapStore';
import styles from './MapCanvas.module.css';

const nodeTypes = { system: SystemNode };
const edgeTypes = { connection: ConnectionEdge };
const LONG_PRESS_MS = 500;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const FIT_MAX_ZOOM = 1;
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

export type MenuTarget =
  | { kind: 'system'; solarSystemId: number }
  | { kind: 'connection'; connectionId: string }
  | { kind: 'pane'; flow: { x: number; y: number }; fitChain(): void; centerOnMe(): void };

interface Props {
  mapId: string;
  state: MapState;
  loaded: boolean;
  labels: LabelDto[];
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
  /** Pixels at the bottom covered by the widget sheet (phones). */
  coveredBottom?: number;
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
  universe,
  can,
  store,
  onSelect,
  onSelectConnection,
  traffic,
  focus,
  onMenu,
  coveredRight = 0,
  coveredBottom = 0,
}: Props) {
  const { theme } = useTheme();
  const toast = useToast();
  const me = useMe();
  const { preferences, settled, update: updatePreferences } = useMapPreferences(mapId);
  const rf = useReactFlow<SystemNodeType, ConnectionEdgeType>();
  const [nodes, setNodes, onNodesChange] = useNodesState<SystemNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<ConnectionEdgeType>([]);
  const opened = useRef(false);
  const handledFocus = useRef(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);

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

  const template =
    preferences.bookmarkTemplate ?? state.map?.settings.bookmarkTemplate ?? DEFAULT_BOOKMARK_TEMPLATE;
  // `{n}` in the viewer's own order is counted here; in the map's order it is the shared number.
  const mapOrder = state.map?.settings.bookmarkNumbering?.order ?? 'found';
  const ownOrder =
    preferences.bookmarkOrder && preferences.bookmarkOrder !== mapOrder
      ? preferences.bookmarkOrder
      : undefined;
  const bookmarks = useMemo(() => {
    const chain = bookmarkChain({
      systems: [...state.systems.values()],
      connections: [...state.connections.values()],
      signatures: [...state.signatures.values()],
      classOf: (id) => bookmarkClassLabel(universe.get(id)),
      // Stored numbers are the sources' own on a merged map: it counts in its order here.
      order: ownOrder ?? (state.sources ? mapOrder : undefined),
    });
    return new Map([...chain].map(([id, vars]) => [id, bookmarkLabel(template, vars)]));
  }, [
    state.systems,
    state.connections,
    state.signatures,
    state.sources,
    universe,
    template,
    ownOrder,
    mapOrder,
  ]);

  // Store -> React Flow, keeping what React Flow owns: measurements, selection, a drag in progress.
  useEffect(() => {
    const here = new Map<number, number>();
    for (const c of state.characters.values()) {
      if (c.online && c.solarSystemId !== null)
        here.set(c.solarSystemId, (here.get(c.solarSystemId) ?? 0) + 1);
    }
    const hubs = exitHubs(state.exits);
    const labelById = new Map(labels.map((l) => [l.id, l]));
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
          draggable: can.edit && !system.locked,
          data: {
            mapId,
            system,
            info,
            labels: system.labelIds.flatMap((l) => labelById.get(l) ?? []),
            characters: here.get(system.solarSystemId) ?? 0,
            bookmark: bookmarks.get(system.solarSystemId) ?? null,
            hub: hubs.get(system.solarSystemId) ?? null,
            mine: myLocation?.solarSystemId === system.solarSystemId,
          },
        };
      });
    });
  }, [
    state.systems,
    state.characters,
    state.exits,
    labels,
    universe,
    can.edit,
    mapId,
    setNodes,
    bookmarks,
    myLocation,
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
          selected: selected.has(c.id),
          data: {
            mapId,
            connection: c,
            sourceName: name(c.source),
            targetName: name(c.target),
            traffic: traffic?.get(c.id),
          },
        }));
    });
  }, [state.connections, state.systems, universe, mapId, setEdges, traffic]);

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
    if (opened.current || !loaded || !settled || nodes.length === 0) return;
    if (!nodes.every((n) => n.measured?.width)) return; // runs again once React Flow measured them
    opened.current = true;
    if (isViewport(preferences.viewport)) {
      // Saved as the point in the middle of the view, so it fits a phone and a desktop alike.
      const { x, y, zoom } = preferences.viewport;
      centerOn({ x, y }, zoom, false);
      return;
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
    const bottom = y + (node.position.y + (node.measured?.height ?? 90)) * zoom;
    const dx = Math.max(0, right - (box.width - coveredRight - 24));
    const dy = Math.max(0, bottom - (box.height - coveredBottom - 24));
    if (dx > 0 || dy > 0) void rf.setViewport({ x: x - dx, y: y - dy, zoom }, { duration: 250 });
  }, [coveredRight, coveredBottom, selectedId, rf]);

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

  // F fits the chain, C centres on me, L toggles the legend.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'f') fitChain();
      else if (key === 'c') centerOnMe();
      else if (key === 'l') setLegend(!legend);
      else return;
      e.preventDefault();
      track('shortcut_used', {
        shortcut: key === 'f' ? 'fit_chain' : key === 'c' ? 'center_on_me' : 'legend',
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitChain, centerOnMe, setLegend, legend]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const saveViewport = (viewport: Viewport) => {
    if (!opened.current) return;
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
    if (e.pointerType === 'mouse') return;
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
  };

  const openMenuAt = (target: Element, x: number, y: number) => {
    const node = target.closest<HTMLElement>('.react-flow__node');
    if (node?.dataset.id) return onMenu({ kind: 'system', solarSystemId: Number(node.dataset.id) }, x, y);
    const edge = target.closest<SVGElement>('.react-flow__edge');
    if (edge?.dataset.id) return onMenu({ kind: 'connection', connectionId: edge.dataset.id }, x, y);
    if (target.closest('.react-flow__pane')) {
      onMenu({ kind: 'pane', flow: rf.screenToFlowPosition({ x, y }), fitChain, centerOnMe }, x, y);
    }
  };

  const onSelectionChange = ({ nodes: selected, edges: edgesSelected }: OnSelectionChangeParams) => {
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
      style={mapTypeVars}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
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
        onNodeContextMenu={(e, node) => {
          e.preventDefault();
          onMenu({ kind: 'system', solarSystemId: Number(node.id) }, e.clientX, e.clientY);
        }}
        onEdgeContextMenu={(e, edge) => {
          e.preventDefault();
          onMenu({ kind: 'connection', connectionId: edge.id }, e.clientX, e.clientY);
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          const flow = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          onMenu({ kind: 'pane', flow, fitChain, centerOnMe }, e.clientX, e.clientY);
        }}
        connectionMode={ConnectionMode.Loose}
        nodesConnectable={can.edit}
        nodesDraggable={can.edit}
        nodeDragThreshold={4}
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
        <Background gap={24} />
        <MapControls
          mapId={mapId}
          can={can}
          onFit={fitChain}
          onCenterMe={centerOnMe}
          located={myLocation !== null}
          legend={legend}
          onLegend={setLegend}
        />
      </ReactFlow>
    </div>
  );
}
