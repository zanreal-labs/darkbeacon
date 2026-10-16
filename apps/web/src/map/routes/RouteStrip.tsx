'use client';

import { useState, type CSSProperties, type MouseEvent } from 'react';
import type { RouteStepDto } from '@darkbeacon/shared';
import { SECURITY_COLORS, shownSecurity } from '../nodeFacts';
import styles from './routes.module.css';

export type StepShape = 'square' | 'round' | 'triangle';

/**
 * Wormhole space by the SDE's wormholeClassID: C1-C6, Thera (12; 31000005 is the only class 12
 * system), the shattered C13s and the Drifter systems (14-18).
 */
const isWormhole = (c: number | null) => c !== null && ((c >= 1 && c <= 6) || (c >= 12 && c <= 18));

/**
 * Pochven: region 10000070, wormholeClassID 25 in the SDE, 27 systems in three constellations
 * (https://wiki.eveuniversity.org/Pochven).
 */
const POCHVEN = 25;

/** Zarzakh (30100000): the fork draws its mark in its own near-black, whatever its security. */
const ZARZAKH = 30100000;

/**
 * Colours of the marks that are not known space: the hex values of Wanderer's
 * `--eve-wh-type-color-*` (assets/js/hooks/Mapper/components/map/styles/eve-common-variables.scss),
 * chosen the way its `getBackgroundClass` (components/map/helpers/getBackgroundClass.ts) does:
 * wormhole classes by `WORMHOLE_CLASS_BACKGROUND_CLASSES`, Pochven by `eve-kind-background-pochven`
 * (the C6 red), Zarzakh by `eve-kind-background-zarzakh`. No theme recolours them.
 */
export const SPACE_COLORS = {
  c1: '#69bfce',
  c2: '#6991ce',
  c3: '#a8cb70',
  c4: '#e39c68',
  c5: '#de8686',
  c6: '#e76363',
  thera: '#ffffff',
  c13: '#988cb5',
  drifter: '#ff44f6',
  pochven: '#e76363',
  zarzakh: '#212121',
} as const;

const WORMHOLE_COLOR: Readonly<Record<number, string>> = {
  1: SPACE_COLORS.c1,
  2: SPACE_COLORS.c2,
  3: SPACE_COLORS.c3,
  4: SPACE_COLORS.c4,
  5: SPACE_COLORS.c5,
  6: SPACE_COLORS.c6,
  12: SPACE_COLORS.thera,
  13: SPACE_COLORS.c13,
  14: SPACE_COLORS.drifter,
  15: SPACE_COLORS.drifter,
  16: SPACE_COLORS.drifter,
  17: SPACE_COLORS.drifter,
  18: SPACE_COLORS.drifter,
};

/** Known space in the game's own security palette (negative systems take the 0.0 red). */
function securityColor(security: number): string {
  return SECURITY_COLORS[Math.max(0, Math.min(1, shownSecurity(security))).toFixed(1)]!;
}

type LookOf = Pick<RouteStepDto, 'whClass' | 'security' | 'invasion'> & { solarSystemId?: number };

/**
 * How a system of a route is drawn, as Wanderer's route list draws it
 * (components/mapInterface/widgets/RoutesWidget/RoutesList/RoutesList.tsx, with
 * components/map/helpers/getShapeClass.ts and getBackgroundClass.ts):
 * - shape: a triangle for Pochven and for known space the Triglavian invasion changed (EDENCOM
 *   fortresses, Triglavian minor victories, systems taken into Pochven); a square rounded by 40%
 *   for wormhole space, Thera included; a plain square for the rest of known space.
 * - colour: wormhole space in its class colour (Thera white), Pochven in the C6 red, Zarzakh
 *   near-black, known space in its security colour.
 * Turnur (30002086, true security 0.387 in Metropolis) has no mark of its own, neither in the fork
 * nor among the SDE's class ids (wormholeClassID 8): it is drawn as the 0.4 system it is.
 */
export function stepLook(step: LookOf): { color: string; shape: StepShape } {
  const c = step.whClass;
  const shape: StepShape =
    c === POCHVEN || (!isWormhole(c) && step.invasion !== undefined)
      ? 'triangle'
      : isWormhole(c)
        ? 'round'
        : 'square';
  if (step.solarSystemId === ZARZAKH) return { color: SPACE_COLORS.zarzakh, shape };
  const wormhole = c === null ? undefined : WORMHOLE_COLOR[c];
  if (wormhole) return { color: wormhole, shape };
  if (c === POCHVEN) return { color: SPACE_COLORS.pochven, shape };
  return { color: securityColor(step.security), shape };
}

/**
 * The colour of a system's class in its tooltip, as Wanderer's `getSystemClassStyles` picks it:
 * known space (Zarzakh included) in its security colour, wormholes and Pochven as their mark.
 */
export function stepClassColor(step: LookOf): string {
  if (step.solarSystemId === ZARZAKH) return securityColor(step.security);
  return stepLook(step).color;
}

/** "C3", "0.5", "Thera", "Pochven": the kind of space in a few characters. */
export function stepClass(step: Pick<RouteStepDto, 'whClass' | 'security'>): string {
  const c = step.whClass;
  if (c !== null && c >= 1 && c <= 6) return `C${c}`;
  if (c === 12) return 'Thera';
  if (c === 13) return 'Shattered';
  if (c !== null && c >= 14 && c <= 18) return 'Drifter';
  if (c === POCHVEN) return 'Pochven';
  return shownSecurity(step.security).toFixed(1);
}

interface Props {
  steps: readonly RouteStepDto[];
  /** A left click on a system (centres the map on it when it is on the map). */
  onSelect?(step: RouteStepDto): void;
  /** A right click on a system, at the pointer. */
  onMenu?(step: RouteStepDto, at: { x: number; y: number }): void;
}

/**
 * A route as a row of small marks, one per system after the start, as Wanderer draws it: 8 px
 * marks 2 px apart, wrapping, shaped and coloured by the kind of space (see `stepLook`). Hovering
 * one names it - its security or class in that colour, and its name, nothing else - and fades
 * the others.
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
        return (
          <button
            key={`${i}-${step.solarSystemId}`}
            type="button"
            className={styles.step}
            data-shape={look.shape}
            data-active={hover?.i === i || undefined}
            style={{ '--step-color': look.color } as CSSProperties}
            aria-label={`${stepClass(step)} ${step.name}`}
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
          <span className={styles.stepTipClass} style={{ color: stepClassColor(current) }}>
            {stepClass(current)}
          </span>
          <span className={styles.stepTipName}>{current.name}</span>
        </span>
      )}
    </span>
  );
}
