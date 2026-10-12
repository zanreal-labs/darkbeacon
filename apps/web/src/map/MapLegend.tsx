import type { ReactNode } from 'react';
import { cssVar, type TokenName } from '@darkbeacon/theme-sdk';
import edgeStyles from './ConnectionEdge.module.css';
import styles from './MapControls.module.css';

/** A short sample of a connection line, drawn with the same tokens and classes as the real edge. */
function Line({
  token = 'edge-color',
  eol = false,
  dangerous = false,
  bubble = false,
}: {
  token?: TokenName;
  eol?: boolean;
  dangerous?: boolean;
  bubble?: boolean;
}) {
  const d = 'M 3,8 L 37,8';
  return (
    <svg className={styles.sample} viewBox="0 0 40 16" aria-hidden>
      {dangerous && <path d={d} className={edgeStyles.danger} />}
      <path
        d={d}
        fill="none"
        stroke={cssVar(token)}
        strokeWidth="var(--dbk-edge-width)"
        strokeDasharray={eol ? '7 5' : undefined}
      />
      {eol && <path d={d} className={edgeStyles.eol} />}
      {bubble && <circle cx={31} cy={8} r={4.5} className={edgeStyles.bubble} />}
    </svg>
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

/** What the colours, patterns and chips of a connection mean. */
export function MapLegend({ id }: { id: string }) {
  return (
    <section id={id} className={styles.legend} aria-label="Connection legend">
      <h2 className={styles.legendTitle}>Connections</h2>
      <ul className={styles.legendList}>
        <Row sample={<Line />}>Wormhole, fresh</Row>
        <Row sample={<Line token="edge-mass-reduced" />}>Mass reduced (10–50 %)</Row>
        <Row sample={<Line token="edge-mass-critical" />}>Mass critical (under 10 %)</Row>
        <Row sample={<Line eol />}>End of life (under 4 h)</Row>
        <Row sample={<Line token="edge-gate" />}>Stargate</Row>
        <Row sample={<Line token="edge-bridge" />}>Jump bridge</Row>
        <Row sample={<Line dangerous />}>Dangerous</Row>
        <Row sample={<Line bubble />}>Bubbled at that end</Row>
      </ul>
      <h2 className={styles.legendTitle}>Largest ship</h2>
      <ul className={styles.legendList}>
        <Row sample={<span className={edgeStyles.chip}>S</span>}>Frigates and destroyers</Row>
        <Row sample={<span className={edgeStyles.chip}>M</span>}>Up to battlecruisers</Row>
        <Row sample={<span className={edgeStyles.chip}>L</span>}>Up to battleships</Row>
        <Row sample={<span className={edgeStyles.chip}>XL</span>}>Capitals and freighters</Row>
      </ul>
    </section>
  );
}
