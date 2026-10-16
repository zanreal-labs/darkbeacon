'use client';

import { memo, useEffect, useMemo, useRef, type PointerEvent } from 'react';
import {
  Panel,
  useEdges,
  useNodes,
  useReactFlow,
  useStore,
  useStoreApi,
  type Edge,
  type Node,
} from '@xyflow/react';
import type { SystemNodeType } from '../SystemNode';
import type { Corner } from './prefs';
import {
  MINIMAP_SIZE,
  minimapProjection,
  toFlow,
  viewFrame,
  viewportCenteredOn,
  type Point,
  type Size,
} from './minimapProjection';
import styles from './canvas.module.css';

/** A node not measured yet is drawn at about a system's size. */
const FALLBACK = { width: 140, height: 50 };
/** Pointer travel (px) after which a press is a drag, not a click. */
const DRAG_THRESHOLD = 3;

interface Block {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  bright: boolean;
}

function blocks(nodes: Node[]): Block[] {
  return nodes
    .filter((n) => !n.hidden)
    .map((n) => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      width: n.measured?.width ?? n.width ?? FALLBACK.width,
      height: n.measured?.height ?? n.height ?? FALLBACK.height,
      bright: !!n.selected || (n as SystemNodeType).data?.system?.status === 'home',
    }));
}

/** The chain in flow units; drawn once per nodes/edges change, moved by the parent's transform. */
const Chain = memo(function Chain({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) {
  const list = useMemo(() => blocks(nodes), [nodes]);
  const lines = useMemo(() => {
    const centre = new Map(list.map((b) => [b.id, { x: b.x + b.width / 2, y: b.y + b.height / 2 }]));
    return edges.flatMap((e) => {
      const a = centre.get(e.source);
      const b = centre.get(e.target);
      return a && b ? [{ id: e.id, a, b }] : [];
    });
  }, [list, edges]);
  return (
    <>
      <g className={styles.minimapEdges}>
        {lines.map(({ id, a, b }) => (
          <line key={id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
      {list.map((b) => (
        <rect
          key={b.id}
          className={b.bright ? styles.minimapBright : styles.minimapNode}
          x={b.x}
          y={b.y}
          width={b.width}
          height={b.height}
          rx={8}
        />
      ))}
    </>
  );
});

/**
 * The minimap in the corner the viewer chose: the view always in the middle at a fixed size,
 * the chain around it moving under it. Drag it to pan, click to centre there, wheel to zoom.
 */
export function CanvasMinimap({ corner }: { corner: Corner }) {
  const viewport = useStore((s) => s.transform);
  const paneWidth = useStore((s) => s.width);
  const paneHeight = useStore((s) => s.height);
  const nodes = useNodes();
  const edges = useEdges();
  const store = useStoreApi();
  const { setViewport } = useReactFlow();
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ start: Point; center: Point; scale: number; moved: boolean } | null>(null);

  const [x, y, zoom] = viewport;
  const pane: Size = useMemo(() => ({ width: paneWidth, height: paneHeight }), [paneWidth, paneHeight]);
  const projection = minimapProjection({ x, y, zoom }, pane);
  const frame = viewFrame(pane, projection, zoom);
  const { width: W, height: H } = MINIMAP_SIZE;
  const { center, scale } = projection;

  // React's wheel listener is passive; the page must not scroll under the minimap.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { transform, width, height, minZoom, maxZoom } = store.getState();
      const [vx, vy, z] = transform;
      const step = e.deltaMode === 1 ? 0.05 : 0.002;
      const next = Math.min(maxZoom, Math.max(minZoom, z * 2 ** (-e.deltaY * step)));
      const at = minimapProjection({ x: vx, y: vy, zoom: z }, { width, height }).center;
      void setViewport(viewportCenteredOn(at, next, { width, height }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [store, setViewport]);

  const local = (e: PointerEvent): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <Panel position={corner} className={`${styles.minimap} ${styles[corner]}`}>
      <svg
        ref={svg}
        role="img"
        aria-label="Minimap"
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          drag.current = { start: local(e), center, scale, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const p = local(e);
          const dx = p.x - d.start.x;
          const dy = p.y - d.start.y;
          if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
          d.moved = true;
          // The chain follows the pointer, so the view goes the other way.
          const next = { x: d.center.x - dx / d.scale, y: d.center.y - dy / d.scale };
          void setViewport(viewportCenteredOn(next, zoom, pane));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.moved) return;
          void setViewport(viewportCenteredOn(toFlow(local(e), projection), zoom, pane), { duration: 200 });
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <g
          data-testid="minimap-chain"
          transform={`translate(${W / 2 - center.x * scale} ${H / 2 - center.y * scale}) scale(${scale})`}
        >
          <Chain nodes={nodes} edges={edges} />
        </g>
        <path
          className={styles.minimapMask}
          fillRule="evenodd"
          d={`M0 0H${W}V${H}H0Z M${frame.x} ${frame.y}h${frame.width}v${frame.height}h${-frame.width}Z`}
        />
        <rect
          data-testid="minimap-frame"
          className={styles.minimapFrame}
          x={frame.x}
          y={frame.y}
          width={frame.width}
          height={frame.height}
        />
      </svg>
    </Panel>
  );
}
