import type { CSSProperties, ReactNode } from 'react';
import { SystemStatus, type ConnectionDto } from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import { Kbd } from '../ui';
import { edgeInnerStyle, edgeOuterStyle, edgeVisual, EOL_WINDOW_MS } from './edgeStyle';
import { STATUS_BORDER, STATUS_LABEL } from './nodeFacts';
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
    label: 'Core amber: mass reduced (10–50 %)',
    connection: { ...BASE, massStatus: 'reduced' },
  },
  {
    key: 'critical',
    label: 'Core red: mass critical (under 10 %)',
    connection: { ...BASE, massStatus: 'critical' },
  },
  {
    key: 'eol',
    label: 'Outside purple: end of life (under 4 h)',
    connection: { ...BASE, timeStatus: 'eol' },
  },
  {
    key: 'timeCritical',
    label: 'Outside pink: under an hour left',
    connection: { ...BASE, timeStatus: 'eol', eolAt: LEGEND_NOW - EOL_WINDOW_MS + 30 * 60_000 },
  },
  { key: 'dangerous', label: 'Red halo: dangerous', connection: { ...BASE, dangerous: true } },
  { key: 'small', label: 'S: frigates and destroyers only', connection: { ...BASE, shipSize: 'small' } },
  { key: 'medium', label: 'M: up to battlecruisers', connection: { ...BASE, shipSize: 'medium' } },
  { key: 'xlarge', label: 'XL: up to freighters', connection: { ...BASE, shipSize: 'xlarge' } },
  { key: 'capital', label: 'C: capitals', connection: { ...BASE, shipSize: 'capital' } },
  { key: 'bubbled', label: 'Circle: bubbled at that end', connection: { ...BASE, bubbled: 'target' } },
  { key: 'gate', label: 'Stargate', connection: { ...BASE, type: 'gate', shipSize: 'capital' } },
  {
    key: 'bridge',
    label: 'Ansiblex jump bridge',
    connection: { ...BASE, type: 'bridge', shipSize: 'capital' },
  },
];

/** A short piece of connection drawn exactly like the real edge. */
function EdgeSample({ connection }: { connection: ConnectionDto }) {
  const v = edgeVisual(connection, LEGEND_NOW);
  const inner = edgeInnerStyle(v);
  const d = 'M 4,12 L 60,12';
  return (
    <span className={styles.edgeSample} data-legend-edge>
      <svg viewBox="0 0 64 24" aria-hidden className={styles.sample}>
        {v.halo && <path d={d} className={edgeStyles.halo} />}
        <path d={d} fill="none" style={edgeOuterStyle(v)} data-line />
        {inner && <path d={d} fill="none" style={inner} data-core />}
      </svg>
      {v.bubbles.length > 0 && <span className={`${edgeStyles.bubble} ${styles.sampleBubble}`} />}
      {v.size && <span className={`${edgeStyles.size} ${styles.sampleSize}`}>{v.size}</span>}
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
                style={{ '--status': cssVar(STATUS_BORDER[s]) } as CSSProperties}
              />
            }
          >
            {STATUS_LABEL[s]}
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
