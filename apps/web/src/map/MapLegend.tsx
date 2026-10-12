import type { CSSProperties, ReactNode } from 'react';
import { SystemStatus, type ConnectionDto } from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import { Kbd } from '../ui';
import { EdgeBadgeChip } from './ConnectionEdge';
import { edgeLineStyle, edgeVisual } from './edgeStyle';
import { STATUS_LABEL } from './nodeFacts';
import edgeStyles from './ConnectionEdge.module.css';
import styles from './MapControls.module.css';

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
  { key: 'reduced', label: 'Mass reduced (10–50 % left)', connection: { ...BASE, massStatus: 'reduced' } },
  { key: 'critical', label: 'Mass critical (under 10 %)', connection: { ...BASE, massStatus: 'critical' } },
  { key: 'eol', label: 'End of life (under 4 h)', connection: { ...BASE, timeStatus: 'eol' } },
  { key: 'small', label: 'Frigates only', connection: { ...BASE, shipSize: 'small' } },
  { key: 'medium', label: 'Up to battlecruisers', connection: { ...BASE, shipSize: 'medium' } },
  { key: 'xlarge', label: 'Capitals pass', connection: { ...BASE, shipSize: 'xlarge' } },
  { key: 'dangerous', label: 'Dangerous', connection: { ...BASE, dangerous: true } },
  { key: 'bubbled', label: 'Bubbled at that end', connection: { ...BASE, bubbled: 'target' } },
  { key: 'gate', label: 'Stargate', connection: { ...BASE, type: 'gate', shipSize: 'xlarge' } },
  {
    key: 'bridge',
    label: 'Ansiblex jump bridge',
    connection: { ...BASE, type: 'bridge', shipSize: 'xlarge' },
  },
];

/** A short piece of connection drawn exactly like the real edge, with its badges. */
function EdgeSample({ connection }: { connection: ConnectionDto }) {
  const v = edgeVisual(connection);
  const d = 'M 4,12 L 60,12';
  return (
    <span className={styles.edgeSample} data-legend-edge>
      <svg viewBox="0 0 64 24" aria-hidden className={styles.sample}>
        {v.halo && <path d={d} className={edgeStyles.halo} />}
        <path d={d} fill="none" style={edgeLineStyle(v)} data-line />
      </svg>
      {v.bubbles.length > 0 && <span className={`${edgeStyles.bubble} ${styles.sampleBubble}`} />}
      {v.badges.length > 0 && (
        <span className={styles.sampleBadges}>
          {v.badges.map((b) => (
            <EdgeBadgeChip key={b.kind} badge={b} />
          ))}
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

/** What the colours, patterns, widths and badges of systems and connections mean. */
export function MapLegend({ id }: { id: string }) {
  return (
    <section id={id} className={styles.legend} aria-label="Map legend">
      <h2 className={styles.legendTitle}>Connections</h2>
      <p className={styles.legendNote}>Colour is mass, dashes are time, width is ship size.</p>
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
                style={{ '--tint': cssVar(`node-status-${s}`) } as CSSProperties}
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
      </ul>
    </section>
  );
}
