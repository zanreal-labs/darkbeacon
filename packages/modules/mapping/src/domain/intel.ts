import {
  classLabel,
  destinationOfClass,
  wormholeDestination,
  type ConnectionIntelDto,
  type ConnectionSideDto,
  type HullClass,
  type HullClassDto,
  type MassStatus,
  type ShipSize,
  type UniverseSystemDto,
  type Urgency,
  type WormholeTypeDto,
} from '@darkbeacon/shared';
import type { Connection, Passage, Signature } from './map.js';
type UniverseSystem = UniverseSystemDto;

const HOUR = 60 * 60 * 1000;
/** "Less than 4 hours remaining": what EOL means in game. */
export const EOL_WINDOW_MS = 4 * HOUR;

/** Upper bound of the mass left, as a share of the total, for each in-game mass status. */
const MASS_CAP: Record<MassStatus, number> = { fresh: 1, reduced: 0.5, critical: 0.1 };

/** Conservative max jump mass of a connection size when its wormhole type is unknown. */
const SIZE_JUMP_MASS: Record<ShipSize, number> = {
  small: 5_000_000,
  medium: 62_000_000,
  large: 375_000_000,
  xlarge: 1_000_000_000,
  capital: 2_000_000_000,
};

const WORMHOLE_CODE = /^[A-Z]\d{3}$/;
const K162 = 'K162';

/** A signature's wormhole type code, upper-cased, or null when it holds none. */
export function signatureTypeCode(signature: Pick<Signature, 'type'> | null | undefined): string | null {
  const code = signature?.type?.trim().toUpperCase() ?? '';
  return WORMHOLE_CODE.test(code) ? code : null;
}

export interface ResolvedType {
  code: string;
  from: 'signature' | 'static';
  side: 'source' | 'target';
}

/**
 * The wormhole type of a connection. A typed signature wins (the side that is not K162); with
 * none, the one static of a side that leads to the other side's class is a guess, but only when
 * exactly one static fits and that side's signature is not a K162.
 */
export function resolveWormholeType(input: {
  connection: Pick<Connection, 'type'>;
  source: UniverseSystem | null;
  target: UniverseSystem | null;
  sourceSignature: Signature | null;
  targetSignature: Signature | null;
  lookup: (code: string) => Pick<WormholeTypeDto, 'destination'> | null;
}): ResolvedType | null {
  if (input.connection.type !== 'wormhole') return null;
  const src = signatureTypeCode(input.sourceSignature);
  const tgt = signatureTypeCode(input.targetSignature);
  if (src && src !== K162 && input.lookup(src)) return { code: src, from: 'signature', side: 'source' };
  if (tgt && tgt !== K162 && input.lookup(tgt)) return { code: tgt, from: 'signature', side: 'target' };

  const guesses: ResolvedType[] = [];
  const guess = (
    from: UniverseSystem | null,
    to: UniverseSystem | null,
    sideType: string | null,
    side: 'source' | 'target',
  ) => {
    if (!from || !to || sideType === K162) return;
    const destination = destinationOfClass(to.whClass);
    if (!destination) return;
    for (const code of from.statics) {
      if ((input.lookup(code)?.destination ?? wormholeDestination(code)) === destination)
        guesses.push({ code, from: 'static', side });
    }
  };
  guess(input.source, input.target, src, 'source');
  guess(input.target, input.source, tgt, 'target');
  return guesses.length === 1 ? guesses[0]! : null;
}

export interface IntelInput {
  connection: Connection;
  source: UniverseSystem | null;
  target: UniverseSystem | null;
  /** Signatures linked to this connection. */
  signatures: readonly Signature[];
  /** Passages through this connection. */
  passages: readonly Passage[];
  wormholeType: (code: string) => WormholeTypeDto | null;
  hullClasses: readonly HullClassDto[];
  now: number;
}

/** Everything the connections panel shows about one connection. */
export function connectionIntel(input: IntelInput): ConnectionIntelDto {
  const { connection: c, now } = input;
  const sigOn = (systemId: number) =>
    input.signatures.find((s) => s.solarSystemId === systemId && s.connectionId === c.id) ?? null;
  const sourceSignature = sigOn(c.source);
  const targetSignature = sigOn(c.target);
  const resolved = resolveWormholeType({
    connection: c,
    source: input.source,
    target: input.target,
    sourceSignature,
    targetSignature,
    lookup: input.wormholeType,
  });
  const type = resolved ? input.wormholeType(resolved.code) : null;
  const isWormhole = c.type === 'wormhole';

  // Time: the hole is at most `lifetime` old when first seen; EOL leaves at most 4 hours.
  const firstSeenAt = Math.min(c.createdAt, ...input.signatures.map((s) => s.createdAt));
  const bounds: number[] = [];
  if (isWormhole && type?.lifetimeHours) bounds.push(firstSeenAt + type.lifetimeHours * HOUR);
  if (isWormhole && c.timeStatus === 'eol') bounds.push((c.eolAt ?? c.updatedAt) + EOL_WINDOW_MS);
  const expiresBy = bounds.length > 0 ? Math.min(...bounds) : null;
  const remainingMs = expiresBy === null ? null : Math.max(0, expiresBy - now);

  // Mass: what the status allowed when it was set, minus what went through since.
  const since = c.massStatusAt ?? null;
  const counted = input.passages.filter((p) => since === null || p.occurredAt >= since);
  const passed = counted.reduce((sum, p) => sum + (p.mass ?? 0), 0);
  const total = isWormhole ? (type?.totalMass ?? null) : null;
  const regenerates =
    total !== null && type?.massRegeneration !== null && (type?.massRegeneration ?? 0) >= total;
  const remaining =
    total === null ? null : regenerates ? total : Math.max(0, MASS_CAP[c.massStatus] * total - passed);
  const remainingFraction = remaining === null || total === null ? null : remaining / total;
  const estimatedStatus: MassStatus | null =
    remainingFraction === null
      ? null
      : remainingFraction < 0.1
        ? 'critical'
        : remainingFraction <= 0.5
          ? 'reduced'
          : 'fresh';

  const maxJumpMass = isWormhole ? (type?.maxJumpMass ?? null) : null;
  const fitsBy = isWormhole ? (maxJumpMass ?? SIZE_JUMP_MASS[c.shipSize]) : Infinity;
  const fits: HullClass[] = input.hullClasses.filter((h) => h.maxMass <= fitsBy).map((h) => h.id);

  let urgency: Urgency = 'ok';
  if (isWormhole) {
    if (
      c.massStatus === 'critical' ||
      estimatedStatus === 'critical' ||
      (remainingMs !== null && remainingMs < HOUR)
    )
      urgency = 'critical';
    else if (
      c.timeStatus === 'eol' ||
      c.massStatus === 'reduced' ||
      estimatedStatus === 'reduced' ||
      (remainingMs !== null && remainingMs < EOL_WINDOW_MS)
    )
      urgency = 'warning';
  }

  return {
    connectionId: c.id,
    type: c.type,
    source: side(c.source, input.source, sourceSignature),
    target: side(c.target, input.target, targetSignature),
    wormholeType: resolved?.code ?? null,
    wormholeTypeFrom: resolved?.from ?? null,
    wormholeTypeSide: resolved?.side ?? null,
    timeStatus: c.timeStatus,
    massStatus: c.massStatus,
    shipSize: c.shipSize,
    massSaved: c.massSaved,
    dangerous: c.dangerous,
    bubbled: c.bubbled,
    maxJumpMass,
    fits,
    mass: {
      total,
      passed,
      passages: counted.length,
      unknownPassages: counted.filter((p) => p.mass === null).length,
      remaining,
      remainingFraction,
      regenerates,
      estimatedStatus,
    },
    time: {
      firstSeenAt,
      lifetimeHours: isWormhole ? (type?.lifetimeHours ?? null) : null,
      eolAt: c.eolAt,
      expiresBy,
      remainingMs,
    },
    totalPassages: input.passages.length,
    ageMs: Math.max(0, now - firstSeenAt),
    urgency,
  };
}

function side(
  solarSystemId: number,
  system: UniverseSystem | null,
  signature: Signature | null,
): ConnectionSideDto {
  return {
    solarSystemId,
    name: system?.name ?? String(solarSystemId),
    whClass: system?.whClass ?? null,
    classLabel: classLabel(system?.whClass),
    security: system?.security ?? 0,
    signature: signature ? { id: signature.id, eveId: signature.eveId, type: signature.type } : null,
  };
}

const URGENCY_RANK: Record<Urgency, number> = { critical: 0, warning: 1, ok: 2 };

/** Most urgent first: urgency, then least time left, then least mass left, then oldest. */
export function byUrgency(a: ConnectionIntelDto, b: ConnectionIntelDto): number {
  const nullsLast = (x: number | null, y: number | null) =>
    x === y ? 0 : x === null ? 1 : y === null ? -1 : x - y;
  return (
    URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
    nullsLast(a.time.remainingMs, b.time.remainingMs) ||
    nullsLast(a.mass.remainingFraction, b.mass.remainingFraction) ||
    a.time.firstSeenAt - b.time.firstSeenAt
  );
}
