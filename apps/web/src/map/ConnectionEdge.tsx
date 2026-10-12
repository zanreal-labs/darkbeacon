'use client';

import { memo, useEffect, useState, type ReactNode } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  useInternalNode,
  type Edge,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';
import type { ConnectionDto, ShipSize } from '@darkbeacon/shared';
import { TriangleAlert } from 'lucide-react';
import { PluginSlot } from '../plugins/PluginSlot';
import { edgeLineStyle, edgeVisual, SHIP_SIZE_TEXT, type EdgeBadge, type EdgeVisual } from './edgeStyle';
import { along, floatingEnds, type Point, type Rect } from './geometry';
import styles from './ConnectionEdge.module.css';

export interface ConnectionEdgeData extends Record<string, unknown> {
  mapId: string;
  connection: ConnectionDto;
  /** Names of the two ends, for the tooltip. */
  sourceName?: string;
  targetName?: string;
}

export type ConnectionEdgeType = Edge<ConnectionEdgeData, 'connection'>;

export const SHIP_SIZE_LABEL: Record<ShipSize, string> = {
  small: 'F',
  medium: 'M',
  large: 'L',
  xlarge: 'XL',
};

function rectOf(node: InternalNode): Rect {
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width: node.measured.width ?? 0,
    height: node.measured.height ?? 0,
  };
}

/** Bubbles sit on the node's edge, pushed a little out so most of the circle shows. */
const BUBBLE_OFFSET = 13;

/** A stargate: an arch on a base line, drawn like the lucide icons around it. */
function GateIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M5 20V11a7 7 0 0 1 14 0v9" />
      <path d="M9 20v-8a3 3 0 0 1 6 0v8" />
      <path d="M2 20h20" />
    </svg>
  );
}

const BADGE_ICON: Partial<Record<EdgeBadge['kind'], ReactNode>> = {
  gate: <GateIcon />,
  dangerous: <TriangleAlert aria-hidden />,
};

/** One badge on the line: an icon for a gate and for danger, short text for the rest. */
export function EdgeBadgeChip({ badge }: { badge: EdgeBadge }) {
  const icon = BADGE_ICON[badge.kind];
  return (
    <span className={styles.badge} data-kind={badge.kind} title={badge.title}>
      {icon ?? badge.label}
      {icon && <span className="sr-only">{badge.label}</span>}
    </span>
  );
}

/** Re-renders once a minute while `on`, so EOL estimates count down. */
function useMinuteClock(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

function typeText(c: ConnectionDto): string {
  if (c.type === 'gate') return 'Stargate';
  if (c.type === 'bridge') return 'Ansiblex jump bridge';
  return `Wormhole · ${SHIP_SIZE_TEXT[c.shipSize]}`;
}

/** Everything about the connection, shown while the pointer is on it. */
function EdgeDetails({ data, visual, at }: { data: ConnectionEdgeData; visual: EdgeVisual; at: Point }) {
  const c = data.connection;
  const name = (end: 'source' | 'target') =>
    (end === 'source' ? data.sourceName : data.targetName) ?? 'this end';
  const lines = [
    ...visual.states.filter((s) => s.kind !== 'gate' && s.kind !== 'bridge').map((s) => s.title),
    ...visual.bubbles.map((end) => `Bubbled on the ${name(end)} side`),
    ...(c.type === 'wormhole' && c.massStatus === 'fresh' ? ['Mass fresh: over 50 % left'] : []),
    ...(c.type === 'wormhole' && c.timeStatus === 'normal' ? ['Lifetime normal'] : []),
    ...(c.massSaved ? ['Mass saved'] : []),
  ];
  return (
    <div
      className={styles.details}
      role="tooltip"
      style={{ transform: `translate(-50%, calc(-100% - 18px)) translate(${at.x}px, ${at.y}px)` }}
    >
      <strong>
        {data.sourceName && data.targetName ? `${data.sourceName} ↔ ${data.targetName}` : typeText(c)}
      </strong>
      {data.sourceName && data.targetName && <span>{typeText(c)}</span>}
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </div>
  );
}

/**
 * The one connection edge: a straight line between node borders in the visual language of
 * `edgeStyle.ts`. Badges sit at the midpoint, bubbles on the bubbled ends above every other line,
 * and the whole line lights up while hovered or selected.
 */
export const ConnectionEdge = memo(function ConnectionEdge({
  id,
  source,
  target,
  data,
  selected,
}: EdgeProps<ConnectionEdgeType>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const [hover, setHover] = useState(false);
  const eol = data?.connection.timeStatus === 'eol' && data.connection.eolAt !== null;
  const now = useMinuteClock(eol);
  if (!sourceNode || !targetNode || !data) return null;

  const c = data.connection;
  const visual = edgeVisual(c, now);
  const { from, to } = floatingEnds(rectOf(sourceNode), rectOf(targetNode));
  const path = `M ${from.x},${from.y} L ${to.x},${to.y}`;
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const bubbles = visual.bubbles.map((end) => ({
    end,
    at: end === 'source' ? along(from, to, BUBBLE_OFFSET) : along(to, from, BUBBLE_OFFSET),
  }));

  return (
    <g
      className={styles.edge}
      data-type={c.type}
      data-mass={c.massStatus}
      data-time={c.timeStatus}
      data-size={c.shipSize}
      data-active={hover || selected || undefined}
      data-pending={c.id.startsWith('pending:') || undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {visual.halo && <path d={path} className={styles.halo} data-underlay="dangerous" />}
      <path d={path} className={styles.highlight} data-underlay="highlight" />
      <BaseEdge id={id} path={path} interactionWidth={22} style={edgeLineStyle(visual)} />
      <EdgeLabelRenderer>
        {bubbles.map(({ end, at }) => (
          <div
            key={end}
            className={styles.bubble}
            data-bubble={end}
            style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}
            title={`Bubbled on the ${(end === 'source' ? data.sourceName : data.targetName) ?? end} side`}
          />
        ))}
        <div
          className={styles.label}
          style={{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)` }}
          data-edge-label={id}
        >
          {visual.badges.map((badge) => (
            <EdgeBadgeChip key={badge.kind} badge={badge} />
          ))}
          <PluginSlot slot="edgeBadge" props={{ mapId: data.mapId, connectionId: c.id }} />
        </div>
        {hover && <EdgeDetails data={data} visual={visual} at={mid} />}
      </EdgeLabelRenderer>
    </g>
  );
});
