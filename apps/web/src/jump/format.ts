import type { Isotope, JumpHull, JumpPlanDto } from '@darkbeacon/shared';
import { securityLabel } from './model';

export const HULL_LABELS: Record<JumpHull, string> = {
  jump_freighter: 'Jump freighters',
  black_ops: 'Black ops',
  rorqual: 'Rorqual',
  carrier: 'Carriers',
  command_carrier: 'Command carriers',
  dreadnought: 'Dreadnoughts',
  lancer: 'Lancer dreadnoughts',
  force_auxiliary: 'Force auxiliaries',
  supercarrier: 'Supercarriers',
  titan: 'Titans',
};

export const ISOTOPE_LABELS: Record<Isotope, string> = {
  helium: 'Helium',
  hydrogen: 'Hydrogen',
  nitrogen: 'Nitrogen',
  oxygen: 'Oxygen',
};

const thousands = new Intl.NumberFormat('en-US');

export function formatNumber(n: number): string {
  return thousands.format(Math.round(n));
}

export function formatLy(ly: number): string {
  return `${ly.toFixed(2)} ly`;
}

/** A jump range: "10 ly", "7.5 ly", "8.4 ly". */
export function formatRange(ly: number): string {
  return `${Number(ly.toFixed(2))} ly`;
}

/** "45 s", "6 min", "1 h 05 min", "5 h". */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0 min';
  if (minutes < 1) return `${Math.round(minutes * 60)} s`;
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')} min`;
}

/**
 * The route as plain text for fleet chat and notes: one line per leg, the cyno to light where a
 * jump lands, totals on top.
 */
export function routeText(plan: JumpPlanDto): string {
  const route = plan.route;
  if (!route || route.legs.length === 0) return '';
  const first = route.legs[0]!.from;
  const last = route.legs[route.legs.length - 1]!.to;
  const isotope = ISOTOPE_LABELS[plan.ship.isotope].toLowerCase();
  const parts = [
    `${route.jumps} ${route.jumps === 1 ? 'jump' : 'jumps'}`,
    ...(route.gates > 0 ? [`${route.gates} ${route.gates === 1 ? 'gate' : 'gates'}`] : []),
    ...(route.ansiblex > 0 ? [`${route.ansiblex} Ansiblex`] : []),
    formatLy(route.ly),
    `${formatNumber(route.fuel)} ${isotope} isotopes`,
  ];
  const cyno = plan.ship.cyno === 'regular' ? 'cyno' : `${plan.ship.cyno} cyno`;
  const lines = [`${plan.ship.name}: ${first.name} > ${last.name} (${parts.join(', ')})`];
  route.legs.forEach((leg, n) => {
    const where = `${leg.to.name} (${securityLabel(leg.to.security)}, ${leg.to.region})`;
    if (leg.kind === 'jump')
      lines.push(`${n + 1}. Jump ${formatLy(leg.ly)} to ${where}, ${cyno}, ${formatNumber(leg.fuel)} fuel`);
    else if (leg.kind === 'gate') lines.push(`${n + 1}. Gate to ${where}`);
    else lines.push(`${n + 1}. Ansiblex to ${where}`);
  });
  lines.push(`Fatigue at the end: ${formatMinutes(route.fatigueMinutes)}`);
  return lines.join('\n');
}
