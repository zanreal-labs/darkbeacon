import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  useInternalNode,
  type Edge,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';
import type { ConnectionDto, ShipSize } from '@wormwright/shared';
import { cssVar, type TokenName } from '@wormwright/theme-sdk';
import { PluginSlot } from '../plugins/PluginSlot';
import { along, floatingEnds, type Rect } from './geometry';
import styles from './ConnectionEdge.module.css';

export interface ConnectionEdgeData extends Record<string, unknown> {
  mapId: string;
  connection: ConnectionDto;
}

export type ConnectionEdgeType = Edge<ConnectionEdgeData, 'connection'>;

export const SHIP_SIZE_LABEL: Record<ShipSize, string> = {
  small: 'S',
  medium: 'M',
  large: 'L',
  xlarge: 'XL',
};

/** Stroke colour: the connection type first, then the mass left on a wormhole. */
export function strokeToken(c: ConnectionDto, selected = false): TokenName {
  if (selected) return 'edge-selected';
  if (c.type === 'gate') return 'edge-gate';
  if (c.type === 'bridge') return 'edge-bridge';
  if (c.massStatus === 'critical') return 'edge-mass-critical';
  if (c.massStatus === 'reduced') return 'edge-mass-reduced';
  return 'edge-color';
}

function rectOf(node: InternalNode): Rect {
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width: node.measured.width ?? 0,
    height: node.measured.height ?? 0,
  };
}

function eolAge(eolAt: number | null, now = Date.now()): string {
  if (eolAt === null) return 'EOL';
  const minutes = Math.max(0, Math.floor((now - eolAt) / 60_000));
  return minutes < 60 ? `EOL ${minutes}m` : `EOL ${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

const BUBBLE_OFFSET = 9;

/**
 * The one connection edge: a straight line between node borders. EOL is dashed, mass and type
 * set the colour, a dangerous connection gets a wide underlay and bubbled ends get markers.
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
  if (!sourceNode || !targetNode || !data) return null;

  const c = data.connection;
  const { from, to } = floatingEnds(rectOf(sourceNode), rectOf(targetNode));
  const path = `M ${from.x},${from.y} L ${to.x},${to.y}`;
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const eol = c.timeStatus === 'eol';
  const ends = [
    ...(c.bubbled === 'source' || c.bubbled === 'both'
      ? [{ end: 'source', at: along(from, to, BUBBLE_OFFSET) }]
      : []),
    ...(c.bubbled === 'target' || c.bubbled === 'both'
      ? [{ end: 'target', at: along(to, from, BUBBLE_OFFSET) }]
      : []),
  ];

  return (
    <g
      className={styles.edge}
      data-type={c.type}
      data-mass={c.massStatus}
      data-time={c.timeStatus}
      data-pending={c.id.startsWith('pending:') || undefined}
    >
      {c.dangerous && <path d={path} className={styles.danger} data-underlay="dangerous" />}
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={18}
        style={{
          stroke: cssVar(strokeToken(c, selected)),
          strokeWidth: 'var(--ww-edge-width)',
          strokeDasharray: eol ? '7 5' : undefined,
        }}
      />
      {eol && <path d={path} className={styles.eol} />}
      {ends.map(({ end, at }) => (
        <circle key={end} cx={at.x} cy={at.y} r={4.5} className={styles.bubble} data-bubble={end}>
          <title>Bubbled at the {end === 'source' ? 'source' : 'target'} end</title>
        </circle>
      ))}
      <EdgeLabelRenderer>
        <div
          className={styles.label}
          style={{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)` }}
          data-edge-label={id}
        >
          <span className={styles.chip} title="Largest ship that fits">
            {SHIP_SIZE_LABEL[c.shipSize]}
          </span>
          {eol && (
            <span className={styles.chip} data-kind="eol" title="End of life: under 4 hours left">
              {eolAge(c.eolAt)}
            </span>
          )}
          {c.massStatus !== 'fresh' && (
            <span className={styles.chip} data-kind={c.massStatus} title="Mass left">
              {c.massStatus === 'reduced' ? 'reduced' : 'critical'}
            </span>
          )}
          {c.massSaved && (
            <span className={styles.chip} title="Mass saved">
              saved
            </span>
          )}
          <PluginSlot slot="edgeBadge" props={{ mapId: data.mapId, connectionId: c.id }} />
        </div>
      </EdgeLabelRenderer>
    </g>
  );
});
