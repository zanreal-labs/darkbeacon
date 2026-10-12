'use client';

import { memo, useEffect, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  useInternalNode,
  type Edge,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';
import type { ConnectionDto, ShipSize } from '@darkbeacon/shared';
import { PluginSlot } from '../plugins/PluginSlot';
import { edgeInnerStyle, edgeOuterStyle, edgeVisual, SHIP_SIZE_TEXT, type EdgeVisual } from './edgeStyle';
import { floatingEnds, type Point, type Rect } from './geometry';
import { lifetimeText } from './sidebar/ConnectionsSection';
import styles from './ConnectionEdge.module.css';

export interface ConnectionEdgeData extends Record<string, unknown> {
  mapId: string;
  connection: ConnectionDto;
  /** Names of the two ends, for the tooltip. */
  sourceName?: string;
  targetName?: string;
}

export type ConnectionEdgeType = Edge<ConnectionEdgeData, 'connection'>;

/** Ship size as the menus and the panel name it. */
export const SHIP_SIZE_LABEL: Record<ShipSize, string> = {
  small: 'S',
  medium: 'M',
  large: 'L',
  xlarge: 'XL',
  capital: 'C',
};

function rectOf(node: InternalNode): Rect {
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width: node.measured.width ?? 0,
    height: node.measured.height ?? 0,
  };
}

/**
 * Bubble ring radius. The ring is centred on the end of the line at the bubbled system and drawn
 * in the edge layer, so the system card covers its inner half: what shows is a wide dashed arc
 * hugging that side of the card, like a warp disruption bubble around the gate you land on.
 */
export const BUBBLE_RADIUS = 26;

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
    ...visual.states.filter((s) => s.kind !== 'size').map((s) => s.title),
    ...visual.bubbles.map((end) => `Bubbled on the ${name(end)} side`),
    ...(c.type === 'wormhole' && c.massStatus === 'fresh' ? ['Mass fresh: over 50 % left'] : []),
    ...(c.type === 'wormhole' && c.timeStatus === 'normal' && !c.lifetime ? ['Lifetime normal'] : []),
    ...(c.type === 'wormhole' && c.lifetime ? [`Lifetime ${lifetimeText(c)}`] : []),
    ...(c.locked ? ['Locked: a map manager can change it'] : []),
    ...(c.note ? [`Note: ${c.note.length > 120 ? `${c.note.slice(0, 119)}…` : c.note}`] : []),
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
 * The one connection edge: a straight two-layer line between node borders in the language of
 * `edgeStyle.ts`. Only a size letter sits at the midpoint; bubbles sit at the bubbled end, under
 * the system card; the whole line lights up while hovered or selected.
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
  const inner = edgeInnerStyle(visual);
  const { from, to } = floatingEnds(rectOf(sourceNode), rectOf(targetNode));
  const path = `M ${from.x},${from.y} L ${to.x},${to.y}`;
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const bubbles = visual.bubbles.map((end) => ({
    end,
    at: end === 'source' ? from : to,
  }));

  return (
    <g
      className={styles.edge}
      data-type={c.type}
      data-mass={c.massStatus}
      data-time={visual.time}
      data-size={c.shipSize}
      data-active={hover || selected || undefined}
      data-pending={c.id.startsWith('pending:') || undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {visual.halo && <path d={path} className={styles.halo} data-underlay="dangerous" />}
      <path d={path} className={styles.highlight} data-underlay="highlight" />
      <path d={path} className={styles.casing} data-underlay="casing" />
      <BaseEdge id={id} path={path} interactionWidth={22} style={edgeOuterStyle(visual)} />
      {inner && <path d={path} fill="none" className={styles.core} style={inner} data-layer="mass" />}
      {bubbles.map(({ end, at }) => (
        <circle key={end} className={styles.bubble} data-bubble={end} cx={at.x} cy={at.y} r={BUBBLE_RADIUS}>
          <title>{`Bubbled on the ${(end === 'source' ? data.sourceName : data.targetName) ?? end} side`}</title>
        </circle>
      ))}
      <EdgeLabelRenderer>
        <div
          className={styles.label}
          style={{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)` }}
          data-edge-label={id}
        >
          {visual.size && (
            <span className={styles.size} data-size={c.shipSize} title={SHIP_SIZE_TEXT[c.shipSize]}>
              {visual.size}
            </span>
          )}
          <PluginSlot slot="edgeBadge" props={{ mapId: data.mapId, connectionId: c.id }} />
        </div>
        {hover && <EdgeDetails data={data} visual={visual} at={mid} />}
      </EdgeLabelRenderer>
    </g>
  );
});
