import type { CSSProperties, ReactNode } from 'react';
import { SystemStatus, type ConnectionDto, type StandingTone } from '@darkbeacon/shared';
import { Kbd } from '../ui';
import { curveBetween } from './edgePath';
import { EdgeShape } from './EdgeShape';
import { edgeVisual, EOL_WINDOW_MS } from './edgeStyle';
import { standingTint, STATUS_LABEL, statusTint } from './nodeFacts';
import { StandingTag } from './NodeIntel';
import edgeStyles from './ConnectionEdge.module.css';
import styles from './MapControls.module.css';

/** The legend's clock, so the "under an hour" sample stays under an hour. */
export const LEGEND_NOW = 1_000_000_000_000;

const BASE: ConnectionDto = {
  id: 'legend',
  mapId: 'legend',
  source: 1,
  target: 2,
  type: 'wormhole',
  timeStatus: 'normal',
  massStatus: 'fresh',
  shipSize: 'large',
  massSaved: false,
  dangerous: false,
  bubbled: 'none',
  eolAt: null,
  createdAt: 0,
  updatedAt: 0,
};

/** Every state the legend explains, as the connection that shows it. */
export const LEGEND_EDGE_STATES: readonly { key: string; label: string; connection: ConnectionDto }[] = [
  { key: 'fresh', label: 'Wormhole, healthy', connection: BASE },
  {
    key: 'reduced',
    label: 'Core amber: less than 50% mass remaining',
    connection: { ...BASE, massStatus: 'reduced' },
  },
  {
    key: 'critical',
    label: 'Core red: less than 10% mass remaining',
    connection: { ...BASE, massStatus: 'critical' },
  },
  {
    key: 'eol',
    label: 'Outside purple: less than 4 hours remaining',
    connection: { ...BASE, timeStatus: 'eol' },
  },
  {
    key: 'timeCritical',
    label: 'Outside pink: less than 1 hour remaining, or expired',
    connection: { ...BASE, timeStatus: 'eol', eolAt: LEGEND_NOW - EOL_WINDOW_MS + 30 * 60_000 },
  },
  { key: 'dangerous', label: 'Red halo: dangerous', connection: { ...BASE, dangerous: true } },
  { key: 'small', label: 'S: frigates and destroyers only', connection: { ...BASE, shipSize: 'small' } },
  { key: 'medium', label: 'M: up to battlecruisers', connection: { ...BASE, shipSize: 'medium' } },
  { key: 'large', label: 'No letter: L, up to battleships', connection: BASE },
  { key: 'xlarge', label: 'XL: freighters and capitals', connection: { ...BASE, shipSize: 'xlarge' } },
  {
    key: 'bubbled',
    label: 'Dashed circle: bubbled at that end',
    connection: { ...BASE, bubbled: 'target' },
  },
  { key: 'gate', label: 'Green: stargate', connection: { ...BASE, type: 'gate', shipSize: 'capital' } },
  {
    key: 'bridge',
    label: 'Dotted lime: Ansiblex jump bridge',
    connection: { ...BASE, type: 'bridge', shipSize: 'capital' },
  },
];

/** Legend rows drawn exactly like another row: a large hole carries no letter, as a healthy one. */
export const LEGEND_SAME_AS: Readonly<Record<string, string>> = { large: 'fresh' };

/** The game's five standing levels, as an unmarked system's tint and the holder's tag. */
export const LEGEND_STANDINGS: readonly { tone: StandingTone; label: string }[] = [
  { tone: 'excellent', label: 'Blue sov +10: yours or excellent' },
  { tone: 'good', label: 'Blue sov +5: good' },
  { tone: 'neutral', label: 'Neutral: no tint' },
  { tone: 'bad', label: 'Orange −5: bad' },
  { tone: 'terrible', label: 'Red −10: terrible' },
];

/** The sample's curve, at the map's own scale: from the right side of one card stub up to the left of another. */
const SAMPLE_CURVE = curveBetween({ x: 12, y: 20 }, 'right', { x: 92, y: 13 }, 'left');

/**
 * A short piece of connection between the ends of two system cards, drawn by the edge's own
 * `EdgeShape`, so every state shows here exactly as on the map (a bubble half under its card).
 */
function EdgeSample({ connection }: { connection: ConnectionDto }) {
  const v = edgeVisual(connection, LEGEND_NOW);
  const { mid } = SAMPLE_CURVE;
  return (
    <span className={styles.edgeSample} data-legend-edge>
      <svg viewBox="0 0 104 30" aria-hidden className={styles.sample}>
        <EdgeShape curve={SAMPLE_CURVE} visual={v} />
        <rect className={styles.sampleCard} x={-6} y={7} width={18} height={26} rx={3} />
        <rect className={styles.sampleCard} x={92} y={0} width={18} height={26} rx={3} />
      </svg>
      {v.size && (
        <span className={`${edgeStyles.size} ${styles.sampleSize}`} style={{ left: mid.x, top: mid.y }}>
          {v.size}
        </span>
      )}
    </span>
  );
}

function Row({ sample, children }: { sample: ReactNode; children: ReactNode }) {
  return (
    <li className={styles.legendRow}>
      {sample}
      <span>{children}</span>
    </li>
  );
}

/** What the colours, letters and shapes of systems and connections mean. */
export function MapLegend({ id }: { id: string }) {
  return (
    <section id={id} className={styles.legend} aria-label="Map legend">
      <h2 className={styles.legendTitle}>Connections</h2>
      <p className={styles.legendNote}>
        The outside of a line is its time, the core its mass. A letter is its ship size.
      </p>
      <ul className={styles.legendList}>
        {LEGEND_EDGE_STATES.map((s) => (
          <Row key={s.key} sample={<EdgeSample connection={s.connection} />}>
            {s.label}
          </Row>
        ))}
      </ul>
      <h2 className={styles.legendTitle}>System status</h2>
      <ul className={styles.legendList}>
        {SystemStatus.options.map((s) => (
          <Row
            key={s}
            sample={
              <span
                className={styles.statusSample}
                data-legend-status={s}
                style={{ '--status-tint': statusTint(s) } as CSSProperties}
              />
            }
          >
            {STATUS_LABEL[s]}
          </Row>
        ))}
      </ul>
      <h2 className={styles.legendTitle}>Sovereignty</h2>
      <p className={styles.legendNote}>
        A system without a status takes the game colour of your standing towards who holds it; the
        holder&apos;s chip below the node is filled with it. A status someone set wins.
      </p>
      <ul className={styles.legendList}>
        {LEGEND_STANDINGS.map(({ tone, label }) => (
          <Row
            key={tone}
            sample={
              <span className={styles.standingSample}>
                <span
                  className={styles.statusSample}
                  data-legend-standing={tone}
                  style={{ '--status-tint': standingTint(tone) } as CSSProperties}
                />
                <StandingTag standing={tone} />
              </span>
            }
          >
            {label}
          </Row>
        ))}
      </ul>
      <h2 className={styles.legendTitle}>Keys</h2>
      <ul className={styles.legendList}>
        <Row sample={<Kbd>F</Kbd>}>Fit the whole chain</Row>
        <Row sample={<Kbd>C</Kbd>}>Center on me</Row>
        <Row sample={<Kbd>L</Kbd>}>Show or hide this legend</Row>
        <Row sample={<Kbd>W</Kbd>}>Wormhole types: sizes, masses, statics</Row>
      </ul>
    </section>
  );
}
