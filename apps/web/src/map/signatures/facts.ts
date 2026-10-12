import {
  destinationOfClass,
  wormholeDestination,
  wormholeTypesIn,
  type ConnectionDto,
  type SignatureDestination,
  type SignatureDto,
  type SignatureGroup,
  type UniverseSystemDto,
  type WormholeDestination,
} from '@darkbeacon/shared';
import type { SignaturePrefs, SignatureSortField } from './prefs';
import { groupShown, kindShown } from './prefs';

export const GROUP_LABEL: Record<SignatureGroup, string> = {
  unknown: 'Unknown',
  wormhole: 'Wormhole',
  combat: 'Combat',
  relic: 'Relic',
  data: 'Data',
  gas: 'Gas',
  ore: 'Ore',
};

/** Where a K162 or C729 leads, as offered in the editor (C729 only leads to k-space and Pochven). */
export const DESTINATION_LABEL: Record<SignatureDestination, string> = {
  hs: 'High-sec',
  ls: 'Low-sec',
  ns: 'Null-sec',
  c1: 'C1',
  c2: 'C2',
  c3: 'C3',
  c4: 'C4',
  c5: 'C5',
  c6: 'C6',
  c13: 'C13',
  thera: 'Thera',
  pochven: 'Pochven',
  c1_c2_c3: 'C1/C2/C3',
  c4_c5: 'C4/C5',
};
export const SHORT_DESTINATION: Record<SignatureDestination, string> = {
  ...DESTINATION_LABEL,
  hs: 'HS',
  ls: 'LS',
  ns: 'NS',
};

/** Types whose destination the pilot sets: K162 (any) and C729 (k-space or Pochven). */
export const MULTI_DESTINATION_TYPES = ['K162', 'C729'] as const;

export function destinationChoices(type: string | null | undefined): SignatureDestination[] {
  const code = type?.trim().toUpperCase();
  if (code === 'C729') return ['hs', 'ls', 'ns', 'pochven'];
  if (code === 'K162')
    return [
      'hs',
      'ls',
      'ns',
      'c1',
      'c2',
      'c3',
      'c4',
      'c5',
      'c6',
      'c13',
      'thera',
      'pochven',
      'c1_c2_c3',
      'c4_c5',
    ];
  return [];
}

/** The classes a signature destination stands for (`c4_c5` -> c4 and c5). */
export function destinationClasses(destination: SignatureDestination): WormholeDestination[] {
  return destination.split('_') as WormholeDestination[];
}

/** Where a signature's hole leads: its own type's destination, else the destination it was given. */
export function signatureLeadsTo(
  sig: Pick<SignatureDto, 'type' | 'destination'>,
): WormholeDestination[] | null {
  const fixed = sig.type ? wormholeDestination(sig.type) : null;
  if (fixed && sig.type?.toUpperCase() !== 'C729') return [fixed];
  return sig.destination ? destinationClasses(sig.destination) : null;
}

/** The other end of a signature's connection. */
export function targetOf(sig: SignatureDto, connections: Map<string, ConnectionDto>): number | null {
  const c = sig.connectionId ? connections.get(sig.connectionId) : undefined;
  if (!c) return null;
  return c.source === sig.solarSystemId ? c.target : c.source;
}

/**
 * Connected systems a signature can lead to: every system connected to its own whose class fits
 * where the hole goes (any, when that is not known).
 */
export function leadsToChoices(
  sig: SignatureDto,
  connections: Iterable<ConnectionDto>,
  universe: Map<number, UniverseSystemDto>,
): { connection: ConnectionDto; systemId: number; fits: boolean }[] {
  const goes = signatureLeadsTo(sig);
  const out: { connection: ConnectionDto; systemId: number; fits: boolean }[] = [];
  for (const c of connections) {
    if (c.source !== sig.solarSystemId && c.target !== sig.solarSystemId) continue;
    const systemId = c.source === sig.solarSystemId ? c.target : c.source;
    const destination = destinationOfClass(universe.get(systemId)?.whClass);
    const fits = !goes || !destination || goes.includes(destination);
    out.push({ connection: c, systemId, fits });
  }
  return out.sort((a, b) => Number(b.fits) - Number(a.fits));
}

/** Wormhole types offered for a signature in `system`: statics and K162, then wanderers. */
export function typeChoices(system: UniverseSystemDto | undefined) {
  return wormholeTypesIn(system?.whClass ?? null, system?.statics ?? []);
}

/** Probe scanner text of a row: "type · name". */
export function infoText(sig: SignatureDto): string {
  return [sig.group === 'wormhole' ? sig.type : null, sig.name].filter(Boolean).join(' · ');
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function sortValue(sig: SignatureDto, field: SignatureSortField): string | number {
  switch (field) {
    case 'eveId':
      return sig.eveId;
    case 'group':
      return GROUP_LABEL[sig.group];
    case 'info':
      return [sig.tempName, sig.type, sig.name].filter(Boolean).join(' ');
    case 'description':
      return sig.description;
    case 'added':
      return sig.createdAt;
    case 'updated':
      return sig.updatedAt;
    case 'author':
      return sig.createdBy?.name ?? '';
  }
}

/** The rows a section shows: filtered by group and sorted (ties by id). */
export function visibleSignatures(
  signatures: readonly SignatureDto[],
  prefs: SignaturePrefs,
): SignatureDto[] {
  const { field, dir } = prefs.sort;
  const sign = dir === 'asc' ? 1 : -1;
  return (
    signatures
      // `other` results (ships, structures) have no site group: only their kind filters them.
      .filter((s) => kindShown(prefs, s.kind) && (s.kind === 'other' || groupShown(prefs, s.group)))
      .sort((a, b) => {
        const x = sortValue(a, field);
        const y = sortValue(b, field);
        const order =
          typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
        return sign * order || collator.compare(a.eveId, b.eveId);
      })
  );
}

/** "D HH:MM:SS"-like age for the Added and Updated columns, compact: `45s`, `12m`, `3h 05m`, `2d 4h`. */
export function ageLabel(ms: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** New rows stand out: `fresh` under a minute, `recent` under ten. */
export function freshness(createdAt: number, now: number): 'fresh' | 'recent' | undefined {
  const age = now - createdAt;
  if (age < 60_000) return 'fresh';
  if (age < 600_000) return 'recent';
  return undefined;
}
