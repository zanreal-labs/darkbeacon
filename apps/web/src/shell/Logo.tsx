import { useId } from 'react';
import styles from './Logo.module.css';

/**
 * Geometry of the Darkbeacon mark on a 24 px grid: a black hole (the core) inside its accretion
 * ring, and a beacon beam leaving it through a break in the ring. Shared with the static icons
 * (`public/favicon.svg`, `public/icons/*`), which repeat these numbers.
 */
export const MARK = {
  core: 3.25,
  ring: 7.25,
  ringWidth: 1.75,
  /**
   * The beam: a cone pointing up-right from `beamInner` (its tip, just outside the core) to an arc
   * at `beamOuter`, `beamSpread` degrees each side.
   */
  beamInner: 4.5,
  beamOuter: 12.25,
  beamSpread: 24,
  /** Clearance cut out of the ring around the beam, in px. */
  gap: 1.1,
} as const;

/** The core sits a little low and left, so the mark with its beam is centred in the square. */
const CX = 11;
const CY = 13;
const rad = (deg: number) => (deg * Math.PI) / 180;
const at = (r: number, deg: number) =>
  `${(CX + r * Math.cos(rad(deg))).toFixed(3)} ${(CY + r * Math.sin(rad(deg))).toFixed(3)}`;

/** The beam cone (towards -45 deg, up-right), grown by about `grow` px on every side. */
export function beamPath(grow = 0): string {
  const tip = MARK.beamInner - grow * 1.6;
  const outer = MARK.beamOuter + grow;
  // Grow the angle so the clearance is about `grow` px where the beam crosses the ring.
  const spread = MARK.beamSpread + (grow / MARK.ring) * (180 / Math.PI);
  return [
    `M ${at(tip, -45)}`,
    `L ${at(outer, -45 - spread)}`,
    `A ${outer} ${outer} 0 0 1 ${at(outer, -45 + spread)}`,
    'Z',
  ].join(' ');
}

const BEAM = beamPath();
const BEAM_GAP = beamPath(MARK.gap);

export interface LogoMarkProps {
  size?: number;
  /**
   * `brand` draws the ring and core in the text colour and the beam in the accent colour;
   * `mono` draws everything in `currentColor`.
   */
  tone?: 'brand' | 'mono';
  /** Sweeps the beam around the ring (stops for people who prefer reduced motion). */
  animated?: boolean;
  className?: string;
}

/** The Darkbeacon mark: a beacon beam sweeping out of a black hole's accretion ring. */
export function LogoMark({ size = 24, tone = 'brand', animated = false, className }: LogoMarkProps) {
  const id = useId().replace(/:/g, '');
  const mask = `dbk-mark-gap-${id}`;
  const fade = `dbk-mark-fade-${id}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={[styles.mark, className].filter(Boolean).join(' ')}
      data-tone={tone}
      data-animated={animated || undefined}
    >
      <defs>
        <mask id={mask} maskUnits="userSpaceOnUse" x="-6" y="-6" width="36" height="36">
          <rect x="-6" y="-6" width="36" height="36" fill="white" />
          <path className={styles.sweep} d={BEAM_GAP} fill="black" />
        </mask>
        <linearGradient id={fade} gradientUnits="userSpaceOnUse" x1="14" y1="10" x2="20" y2="4">
          <stop offset="0" className={styles.beamStart} />
          <stop offset="1" className={styles.beamEnd} />
        </linearGradient>
      </defs>
      <circle
        className={styles.body}
        cx={CX}
        cy={CY}
        r={MARK.ring}
        stroke="currentColor"
        strokeWidth={MARK.ringWidth}
        mask={`url(#${mask})`}
      />
      <circle className={styles.body} cx={CX} cy={CY} r={MARK.core} fill="currentColor" />
      <path
        className={`${styles.sweep} ${styles.beam}`}
        d={BEAM}
        fill={tone === 'brand' ? `url(#${fade})` : 'currentColor'}
      />
    </svg>
  );
}

/** The mark next to the name, for headers. */
export function Wordmark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <span className={[styles.wordmark, className].filter(Boolean).join(' ')}>
      <LogoMark size={size} />
      Darkbeacon
    </span>
  );
}
