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
import type { ConnectionDto } from '@darkbeacon/shared';
import { PluginSlot } from '../plugins/PluginSlot';
import {
  edgeInnerStyle,
  edgeOuterStyle,
  edgeVisual,
  SHIP_SIZE_LABEL,
  SHIP_SIZE_TEXT,
  type EdgeVisual,
} from './edgeStyle';
import { floatingEnds, type Point, type Rect } from './geometry';
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
  const sourceRect = rectOf(sourceNode);
  const targetRect = rectOf(targetNode);
  const { from, to } = floatingEnds(sourceRect, targetRect);
  // The line runs from centre to centre, under the opaque cards, so its layers of different
  // widths never show a stepped cut where it meets a card; the label and bubbles still use the
  // points on the borders.
  const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  const a = centre(sourceRect);
  const b = centre(targetRect);
  const path = `M ${a.x},${a.y} L ${b.x},${b.y}`;
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
