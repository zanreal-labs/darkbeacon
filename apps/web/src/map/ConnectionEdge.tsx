'use client';

import { memo, useEffect, useState } from 'react';
import {
  EdgeLabelRenderer,
  useInternalNode,
  type Edge,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';
import type { ConnectionDto } from '@darkbeacon/shared';
import { PluginSlot } from '../plugins/PluginSlot';
import { edgeCurve } from './edgePath';
import { EdgeShape } from './EdgeShape';
import { edgeVisual, SHIP_SIZE_LABEL, SHIP_SIZE_TEXT, type EdgeVisual } from './edgeStyle';
import type { Point, Rect } from './geometry';
import { lifetimeText } from './widgets/ConnectionsSection';
import styles from './ConnectionEdge.module.css';

/** What went through a connection since its mass was last marked, for the hover card. */
export interface ConnectionTraffic {
  passages: number;
  /** kg */
  passed: number;
}

export interface ConnectionEdgeData extends Record<string, unknown> {
  mapId: string;
  connection: ConnectionDto;
  /** Names of the two ends, for the tooltip. */
  sourceName?: string;
  targetName?: string;
  traffic?: ConnectionTraffic;
}

/** "3 jumps counted, 445 200 t". */
export function trafficLine(traffic: ConnectionTraffic | undefined): string | null {
  if (!traffic || traffic.passages === 0) return null;
  const tonnes = Math.round(traffic.passed / 1000)
    .toLocaleString('en-US')
    .replace(/,/g, ' ');
  return `${traffic.passages} jump${traffic.passages === 1 ? '' : 's'} counted, ${tonnes} t`;
}

export type ConnectionEdgeType = Edge<ConnectionEdgeData, 'connection'>;

export { SHIP_SIZE_LABEL } from './edgeStyle';

function rectOf(node: InternalNode): Rect {
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width: node.measured.width ?? 0,
    height: node.measured.height ?? 0,
  };
}

export { BUBBLE_RADIUS } from './EdgeShape';

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

/** "6 · 30 152 t": jumps counted and the mass they took, since the mass was last marked. */
function trafficShort(traffic: ConnectionTraffic | undefined): string | null {
  if (!traffic || traffic.passages === 0) return null;
  const tonnes = Math.round(traffic.passed / 1000)
    .toLocaleString('en-US')
    .replace(/,/g, ' ');
  return `${traffic.passages} · ${tonnes} t`;
}

type Tone = 'warning' | 'danger' | 'eol' | undefined;

/**
 * The connection at a glance while the pointer is on it: the two ends and the size letter, then a
 * few short rows (mass, life, jumps), coloured only when something is off; flags and the note last.
 */
function EdgeDetails({ data, visual, at }: { data: ConnectionEdgeData; visual: EdgeVisual; at: Point }) {
  const c = data.connection;
  const wormhole = c.type === 'wormhole';
  const name = (end: 'source' | 'target') =>
    (end === 'source' ? data.sourceName : data.targetName) ?? 'this end';
  const state = (kind: string) => visual.states.find((s) => s.kind === kind);
  const rows: Array<{ key: string; value: string; tone?: Tone }> = [];
  if (wormhole) {
    rows.push(
      c.massStatus === 'critical'
        ? { key: 'Mass', value: 'Critical (< 10 %)', tone: 'danger' }
        : c.massStatus === 'reduced'
          ? { key: 'Mass', value: 'Reduced (< 50 %)', tone: 'warning' }
          : { key: 'Mass', value: 'Fresh' },
    );
    const eol = state('timeCritical') ?? state('eol');
    const marked = lifetimeText(c);
    rows.push(
      eol
        ? { key: 'Life', value: eol.title.replace(/^End of life: /, 'EOL, '), tone: 'eol' }
        : marked
          ? { key: 'Life', value: marked.replace(/^under /, '< ') }
          : { key: 'Life', value: 'Normal' },
    );
    const traffic = trafficShort(data.traffic);
    if (traffic) rows.push({ key: 'Jumps', value: traffic });
  }
  const flags = [
    ...(state('dangerous') ? ['Dangerous'] : []),
    ...visual.bubbles.map((end) => `Bubble at ${name(end)}`),
    ...(state('saved') ? ['Mass saved'] : []),
    ...(c.locked ? ['Locked'] : []),
  ];
  return (
    <div
      className={styles.details}
      role="tooltip"
      style={{ transform: `translate(-50%, calc(-100% - 18px)) translate(${at.x}px, ${at.y}px)` }}
    >
      <div className={styles.detailsHead}>
        <strong>
          {data.sourceName && data.targetName
            ? `${data.sourceName} ↔ ${data.targetName}`
            : c.type === 'gate'
              ? 'Stargate'
              : c.type === 'bridge'
                ? 'Jump bridge'
                : 'Wormhole'}
        </strong>
        {wormhole ? (
          <span className={styles.detailsSize} title={SHIP_SIZE_TEXT[c.shipSize]}>
            {SHIP_SIZE_LABEL[c.shipSize]}
          </span>
        ) : (
          <span className={styles.detailsKind}>{c.type === 'gate' ? 'Gate' : 'Ansiblex'}</span>
        )}
      </div>
      {rows.length > 0 && (
        <dl className={styles.detailsRows}>
          {rows.map((r) => (
            <div key={r.key}>
              <dt>{r.key}</dt>
              <dd data-tone={r.tone}>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {flags.length > 0 && <span className={styles.detailsFlags}>{flags.join(' · ')}</span>}
      {c.note && (
        <span className={styles.detailsNote}>{c.note.length > 80 ? `${c.note.slice(0, 79)}…` : c.note}</span>
      )}
    </div>
  );
}

/** Width of the invisible path that takes the pointer, wider than the line so it is easy to hit. */
const INTERACTION_WIDTH = 22;

/**
 * The one connection edge: a smooth curve between the facing sides of two system cards, drawn as
 * Wanderer draws it (`EdgeShape`) in the language of `edgeStyle.ts`. Only a size letter sits at
 * the middle of the curve; bubbles sit at the bubbled end, under the system card; the whole line
 * lights up while hovered or selected.
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
  const curve = edgeCurve(rectOf(sourceNode), rectOf(targetNode));
  const { mid } = curve;

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
      <EdgeShape
        curve={curve}
        visual={visual}
        lineClassName="react-flow__edge-path"
        bubbleTitle={(end) =>
          `Bubbled on the ${(end === 'source' ? data.sourceName : data.targetName) ?? end} side`
        }
      />
      <path
        d={curve.path}
        fill="none"
        strokeOpacity={0}
        strokeWidth={INTERACTION_WIDTH}
        className="react-flow__edge-interaction"
      />
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
