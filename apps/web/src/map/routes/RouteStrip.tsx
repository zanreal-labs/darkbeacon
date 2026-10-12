'use client';

import { useState, type CSSProperties, type MouseEvent } from 'react';
import type { RouteStepDto } from '@darkbeacon/shared';
import { cssVar } from '@darkbeacon/theme-sdk';
import { SECURITY_COLORS, shownSecurity } from '../nodeFacts';
import styles from './routes.module.css';

export type StepShape = 'square' | 'round' | 'triangle';

/** Wormhole space: C1-C6, Thera, the shattered systems and the Drifter systems. */
const isWormhole = (c: number | null) => c !== null && ((c >= 1 && c <= 6) || (c >= 12 && c <= 18));

/**
 * How a system of a route is drawn: known space in its security colour (the game's palette),
 * wormhole space in the class pill colours, round; Pochven and systems the Triglavian invasion
 * changed are triangles.
 */
export function stepLook(step: Pick<RouteStepDto, 'whClass' | 'security' | 'invasion'>): {
  color: string;
  shape: StepShape;
} {
  const c = step.whClass;
  const shape: StepShape =
    c === 25 || step.invasion !== undefined ? 'triangle' : isWormhole(c) ? 'round' : 'square';
  if (c !== null && c >= 1 && c <= 6) return { color: cssVar('pill-wormhole'), shape };
  if (isWormhole(c) || c === 25) return { color: cssVar('pill-special'), shape };
  const level = Math.max(0, Math.min(1, shownSecurity(step.security))).toFixed(1);
  return { color: SECURITY_COLORS[level]!, shape };
}

/** "C3", "0.5", "Thera", "Pochven": the kind of space in a few characters. */
export function stepClass(step: Pick<RouteStepDto, 'whClass' | 'security'>): string {
  const c = step.whClass;
  if (c !== null && c >= 1 && c <= 6) return `C${c}`;
  if (c === 12) return 'Thera';
  if (c === 13) return 'Shattered';
  if (c !== null && c >= 14 && c <= 18) return 'Drifter';
  if (c === 25) return 'Pochven';
  return shownSecurity(step.security).toFixed(1);
}

const INVASION: Record<NonNullable<RouteStepDto['invasion']>, string> = {
  edencom: 'EDENCOM',
  triglavian: 'Triglavian',
  final: 'Pochven',
};

function via(step: RouteStepDto): string | null {
  if (step.edge === 'ansiblex' || step.via === 'bridge') return 'by jump bridge';
  if (step.edge === 'eve-scout') return 'through an EVE-Scout hole';
  if (step.via === 'wormhole') return 'through a wormhole';
  return null;
}

interface Props {
  steps: readonly RouteStepDto[];
  /** A left click on a system (centres the map on it when it is on the map). */
  onSelect?(step: RouteStepDto): void;
  /** A right click on a system, at the pointer. */
  onMenu?(step: RouteStepDto, at: { x: number; y: number }): void;
}

/**
 * A route as a row of small marks, one per system after the start: coloured by security or
 * class, shaped by kind of space, ringed where the route leaves the stargates. Hovering one names
 * it (class, name, region) and fades the others.
 */
export function RouteStrip({ steps, onSelect, onMenu }: Props) {
  const [hover, setHover] = useState<{ i: number; left: number; top: number } | null>(null);
  const shown = steps.slice(1);
  const current = hover === null ? null : shown[hover.i];
  const point = (i: number, el: HTMLElement) => setHover({ i, left: el.offsetLeft + 4, top: el.offsetTop });
  return (
    <span
      className={styles.strip}
      data-hovering={hover !== null || undefined}
      onPointerLeave={() => setHover(null)}
    >
      {shown.map((step, i) => {
        const look = stepLook(step);
        const how = via(step);
        const label = `${stepClass(step)} ${step.name}${step.regionName && !isWormhole(step.whClass) ? `, ${step.regionName}` : ''}${how ? `, ${how}` : ''}`;
        return (
          <button
            key={`${i}-${step.solarSystemId}`}
            type="button"
            className={styles.step}
            data-shape={look.shape}
            data-via={step.edge ?? (step.via === 'gate' ? undefined : step.via)}
            data-active={hover?.i === i || undefined}
            style={{ '--step-color': look.color } as CSSProperties}
            aria-label={label}
            onPointerEnter={(e) => point(i, e.currentTarget)}
            onFocus={(e) => point(i, e.currentTarget)}
            onBlur={() => setHover(null)}
            onClick={() => onSelect?.(step)}
            onContextMenu={(e: MouseEvent) => {
              if (!onMenu) return;
              e.preventDefault();
              onMenu(step, { x: e.clientX, y: e.clientY });
            }}
          />
        );
      })}
      {current && (
        <span className={styles.stepTip} role="tooltip" style={{ left: hover!.left, top: hover!.top }}>
          <span className={styles.stepTipClass} style={{ color: stepLook(current).color }}>
            {stepClass(current)}
          </span>
          <span className={styles.stepTipName}>{current.name}</span>
          {current.regionName && !isWormhole(current.whClass) && (
            <span className={styles.stepTipRegion}>{current.regionName}</span>
          )}
          {current.invasion && <span className={styles.stepTipRegion}>{INVASION[current.invasion]}</span>}
          {via(current) && <span className={styles.stepTipRegion}>{via(current)}</span>}
        </span>
      )}
    </span>
  );
}
