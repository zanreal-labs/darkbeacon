import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Background,
  ConnectionMode,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { LabelDto, UniverseSystemDto } from '@darkbeacon/shared';
import type { MapPermissions } from '../lib/roles';
import { useTheme } from '../theme/ThemeProvider';
import { ConnectionEdge, type ConnectionEdgeType } from './ConnectionEdge';
import type { MapState } from './mapState';
import { SystemNode, type SystemNodeType } from './SystemNode';
import type { MapStore } from './useMapStore';
import styles from './MapCanvas.module.css';

const nodeTypes = { system: SystemNode };
const edgeTypes = { connection: ConnectionEdge };
const LONG_PRESS_MS = 500;

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
}: Props) {
  const { theme } = useTheme();
  const fitOptions = useMemo(
    () => ({
      padding: { top: '72px', left: '48px', bottom: '48px', right: `${coveredRight + 48}px` } as const,
      maxZoom: 1.25,
      // On phones a whole chain would be unreadably small; keep systems legible and let people pan.
      minZoom: typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches ? 0.6 : 0.2,
    }),
    [coveredRight],
  );
  const rf = useReactFlow<SystemNodeType, ConnectionEdgeType>();
  const [nodes, setNodes, onNodesChange] = useNodesState<SystemNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<ConnectionEdgeType>([]);
  const [fitted, setFitted] = useState(false);
  const handledFocus = useRef(0);
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

  useEffect(() => {
    if (fitted || !loaded || nodes.length === 0) return;
    const timer = setTimeout(() => {
      void rf.fitView(fitOptions);
      setFitted(true);
    }, 50);
    return () => clearTimeout(timer);
  }, [fitted, loaded, nodes.length, rf, fitOptions]);

  useEffect(() => {
    if (!focus || handledFocus.current === focus.n) return;
    const id = String(focus.id);
    const node = nodes.find((n) => n.id === id);
    if (!node) return; // not rendered yet; runs again when the nodes change
    handledFocus.current = focus.n;
    setNodes((ns) => ns.map((n) => (!!n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })));
    if (focus.center) {
      void rf.setCenter(node.position.x + 80, node.position.y + 30, { duration: 300, zoom: rf.getZoom() });
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
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} />
        <Controls showInteractive={false} position="bottom-left" fitViewOptions={fitOptions} />
      </ReactFlow>
    </div>
  );
}
