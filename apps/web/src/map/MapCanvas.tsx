'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
import type { LabelDto, UniverseSystemDto } from '@darkbeacon/shared';
import type { MapPermissions } from '../lib/roles';
import { useTheme } from '../theme/ThemeProvider';
import { ConnectionEdge, type ConnectionEdgeType } from './ConnectionEdge';
import { boundsOf, fitViewport, type Rect } from './geometry';
import { MapControls } from './MapControls';
import type { MapState } from './mapState';
import { SystemNode, type SystemNodeType } from './SystemNode';
import type { MapStore } from './useMapStore';
import styles from './MapCanvas.module.css';

const nodeTypes = { system: SystemNode };
const edgeTypes = { connection: ConnectionEdge };
const LONG_PRESS_MS = 500;

/** Below this zoom system names (15 px) get too small to read; the first view never goes lower. */
const READABLE_ZOOM = { desktop: 0.9, phone: 0.75 };
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const FIT_MAX_ZOOM = 1.15;

const isPhone = () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 760px)').matches;

/** The viewer's last viewport of a map, kept in this browser only. */
const viewportKey = (mapId: string) => `dbk-map-viewport:${mapId}`;
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

const isViewport = (v: unknown): v is Viewport =>
  typeof v === 'object' &&
  v !== null &&
  ['x', 'y', 'zoom'].every((k) => Number.isFinite((v as Record<string, unknown>)[k])) &&
  (v as Viewport).zoom >= MIN_ZOOM &&
  (v as Viewport).zoom <= MAX_ZOOM;

/** Moves the selection to a node once it is rendered (it may still be on its way from the store). */
export interface FocusRequest {
  id: number;
  center: boolean;
  n: number;
}

export type MenuTarget =
  | { kind: 'system'; solarSystemId: number }
  | { kind: 'connection'; connectionId: string }
  | { kind: 'pane'; flow: { x: number; y: number } };

interface Props {
  mapId: string;
  state: MapState;
  loaded: boolean;
  labels: LabelDto[];
  universe: Map<number, UniverseSystemDto>;
  can: MapPermissions;
  store: Pick<MapStore, 'moveSystems' | 'addConnection'>;
  onSelect(solarSystemId: number | null): void;
  focus: FocusRequest | null;
  onMenu(target: MenuTarget, x: number, y: number): void;
  /** Pixels on the right covered by the widget panel; fitting the view keeps systems out from under it. */
  coveredRight?: number;
  /** Pixels at the bottom covered by the widget sheet (phones). */
  coveredBottom?: number;
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
  focus,
  onMenu,
  coveredRight = 0,
  coveredBottom = 0,
}: Props) {
  const { theme } = useTheme();
  const rf = useReactFlow<SystemNodeType, ConnectionEdgeType>();
  const [nodes, setNodes, onNodesChange] = useNodesState<SystemNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<ConnectionEdgeType>([]);
  const fitted = useRef(false);
  const handledFocus = useRef(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);

  // Store -> React Flow, keeping what React Flow owns: measurements, selection, a drag in progress.
  useEffect(() => {
    const here = new Map<number, number>();
    for (const c of state.characters.values()) {
      if (c.online && c.solarSystemId !== null)
        here.set(c.solarSystemId, (here.get(c.solarSystemId) ?? 0) + 1);
    }
    const labelById = new Map(labels.map((l) => [l.id, l]));
    setNodes((prev) => {
      const previous = new Map(prev.map((n) => [n.id, n]));
      return [...state.systems.values()].map((system): SystemNodeType => {
        const id = String(system.solarSystemId);
        const old = previous.get(id);
        return {
          ...old,
          id,
          type: 'system',
          position: old?.dragging ? old.position : system.position,
          draggable: can.edit && !system.locked,
          data: {
            mapId,
            system,
            info: universe.get(system.solarSystemId),
            labels: system.labelIds.flatMap((l) => labelById.get(l) ?? []),
            characters: here.get(system.solarSystemId) ?? 0,
          },
        };
      });
    });
  }, [state.systems, state.characters, labels, universe, can.edit, mapId, setNodes]);

  useEffect(() => {
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
          data: { mapId, connection: c },
        }));
    });
  }, [state.connections, state.systems, mapId, setEdges]);

  /** Rectangles of the given nodes (all when omitted), as React Flow measured them. */
  const rectsOf = useCallback(
    (ids?: ReadonlySet<string>): Rect[] =>
      rf
        .getNodes()
        .filter((n) => !ids || ids.has(n.id))
        .map((n) => ({
          x: n.position.x,
          y: n.position.y,
          width: n.measured?.width ?? 200,
          height: n.measured?.height ?? 80,
        })),
    [rf],
  );

  /**
   * Fits `rects` into the part of the canvas no panel covers. The first view keeps systems
   * readable (centred on the home system when the chain is wider than the screen); the buttons
   * may zoom further out.
   */
  const fitTo = useCallback(
    (rects: Rect[], { readable, animate }: { readable: boolean; animate: boolean }) => {
      const bounds = boundsOf(rects);
      const box = canvasRef.current?.getBoundingClientRect();
      if (!bounds || !box) return;
      const phone = isPhone();
      const home = [...state.systems.values()].find((s) => s.status === 'home');
      const homeRect = home && rectsOf(new Set([String(home.solarSystemId)]))[0];
      const viewport = fitViewport(
        bounds,
        box,
        phone
          ? { top: 72, right: 16, bottom: 140, left: 16 }
          : { top: 72, right: coveredRight + 48, bottom: 48, left: 72 },
        {
          minZoom: readable ? READABLE_ZOOM[phone ? 'phone' : 'desktop'] : MIN_ZOOM,
          maxZoom: FIT_MAX_ZOOM,
          anchor: homeRect
            ? { x: homeRect.x + homeRect.width / 2, y: homeRect.y + homeRect.height / 2 }
            : undefined,
        },
      );
      void rf.setViewport(viewport, animate ? { duration: 250 } : undefined);
    },
    [rf, rectsOf, state.systems, coveredRight],
  );

  // First view: where this viewer left the map, else a readable fit.
  useEffect(() => {
    if (fitted.current || !loaded || nodes.length === 0) return;
    if (!nodes.every((n) => n.measured?.width)) return; // runs again once React Flow measured them
    const saved = readStored(viewportKey(mapId), isViewport);
    if (saved) void rf.setViewport(saved);
    else fitTo(rectsOf(), { readable: true, animate: false });
    fitted.current = true;
  }, [loaded, nodes, rf, mapId, fitTo, rectsOf]);

  // A panel that opens over the canvas must not hide the selected system: pan it into view.
  useEffect(() => {
    const box = canvasRef.current?.getBoundingClientRect();
    const node = rf.getNodes().find((n) => n.selected);
    if (!box || !node || (coveredRight === 0 && coveredBottom === 0)) return;
    const { x, y, zoom } = rf.getViewport();
    const right = x + (node.position.x + (node.measured?.width ?? 200)) * zoom;
    const bottom = y + (node.position.y + (node.measured?.height ?? 80)) * zoom;
    const dx = Math.max(0, right - (box.width - coveredRight - 24));
    const dy = Math.max(0, bottom - (box.height - coveredBottom - 24));
    if (dx > 0 || dy > 0) void rf.setViewport({ x: x - dx, y: y - dy, zoom }, { duration: 250 });
  }, [coveredRight, coveredBottom, rf]);

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
  const selectedIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id));

  useEffect(() => {
    if (!focus || handledFocus.current === focus.n) return;
    const id = String(focus.id);
    const node = nodes.find((n) => n.id === id);
    if (!node) return; // not rendered yet; runs again when the nodes change
    handledFocus.current = focus.n;
    setNodes((ns) => ns.map((n) => (!!n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })));
    if (focus.center) {
      void rf.setCenter(
        node.position.x + (node.measured?.width ?? 200) / 2,
        node.position.y + (node.measured?.height ?? 80) / 2,
        { duration: 300, zoom: rf.getZoom() },
      );
    }
  }, [focus, nodes, rf, setNodes]);

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
      onMenu({ kind: 'pane', flow: rf.screenToFlowPosition({ x, y }) }, x, y);
    }
  };

  const onSelectionChange = ({ nodes: selected }: OnSelectionChangeParams) => {
    onSelect(selected.length === 1 ? Number(selected[0]!.id) : null);
  };

  return (
    <div
      ref={canvasRef}
      className={styles.canvas}
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
        onMoveEnd={(_, viewport) => {
          if (fitted.current) writeStored(viewportKey(mapId), viewport);
        }}
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
          onMenu(
            { kind: 'pane', flow: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }) },
            e.clientX,
            e.clientY,
          );
        }}
        connectionMode={ConnectionMode.Loose}
        nodesConnectable={can.edit}
        nodesDraggable={can.edit}
        nodeDragThreshold={4}
        deleteKeyCode={null}
        colorMode={theme.colorScheme}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} />
        <MapControls
          onFit={() => fitTo(rectsOf(), { readable: false, animate: true })}
          onFitSelection={() => fitTo(rectsOf(selectedIds), { readable: false, animate: true })}
          hasSelection={selectedIds.size > 0}
          legend={legend}
          onLegend={setLegend}
        />
      </ReactFlow>
    </div>
  );
}
