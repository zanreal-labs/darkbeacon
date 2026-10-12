import { ConflictError, ForbiddenError, ValidationError } from '@darkbeacon/core';
import type { ChainOrigin, MapShareDto, ShareLevel, ShareScope, ShareStatus } from '@darkbeacon/shared';
import { sameOrigin } from './keys.js';
import { effectiveScopes, normalizeScopes } from './scopes.js';

/** A share of a source map with a target map (the grant), as stored. */
export interface Share {
  id: string;
  source: ChainOrigin;
  target: ChainOrigin;
  level: ShareLevel;
  /** What the source's admins offer. */
  offeredScopes: ShareScope[];
  /** What the target's admins keep of the offer; null keeps all of it. */
  targetScopes: ShareScope[] | null;
  status: ShareStatus;
  /** A higher level offered on an active share, waiting for the target's consent. */
  offeredLevel: ShareLevel | null;
  hidden: boolean;
  /** On a composite: where new objects made on it go. */
  defaultWrite: boolean;
  offeredBy: string;
  acceptedBy: string | null;
  offeredAt: number;
  acceptedAt: number | null;
  updatedAt: number;
}

/** The scopes the target actually receives. */
export function shareScopes(share: Pick<Share, 'offeredScopes' | 'targetScopes'>): ShareScope[] {
  return effectiveScopes(share.offeredScopes, share.targetScopes);
}

export function shareDto(
  share: Share,
  names: { sourceName: string; targetName: string; sourceInstanceName: string | null },
): MapShareDto {
  return {
    id: share.id,
    source: share.source,
    sourceName: names.sourceName,
    target: share.target,
    targetName: names.targetName,
    sourceInstanceName: names.sourceInstanceName,
    level: share.level,
    offeredScopes: normalizeScopes(share.offeredScopes),
    scopes: shareScopes(share),
    status: share.status,
    offeredLevel: share.offeredLevel,
    hidden: share.hidden,
    defaultWrite: share.defaultWrite,
    offeredAt: share.offeredAt,
    acceptedAt: share.acceptedAt,
    updatedAt: share.updatedAt,
  };
}

/** Which side of a share an admin acts for. */
export interface Sides {
  sourceAdmin: boolean;
  targetAdmin: boolean;
}

/** An offer is valid between two different maps; a composite has nothing of its own to give. */
export function checkOffer(
  source: ChainOrigin & { kind: 'standard' | 'composite' },
  target: ChainOrigin,
  existing: readonly Share[],
): void {
  if (sameOrigin(source, target)) throw new ValidationError('A map cannot be shared with itself');
  if (source.kind === 'composite')
    throw new ValidationError(
      'A composite map has no systems of its own to share; share its sources instead',
    );
  if (existing.some((s) => sameOrigin(s.source, source) && sameOrigin(s.target, target)))
    throw new ConflictError('This map is already shared with that map');
}

/**
 * A new share: offered by the source's admin, active at once when the same person administers
 * the target too (both consents in one), else waiting for the target's admin.
 */
export function offerShare(input: {
  id: string;
  source: ChainOrigin;
  target: ChainOrigin;
  level: ShareLevel;
  scopes: readonly ShareScope[];
  by: string;
  sides: Sides;
  now: number;
}): Share {
  const active = input.sides.targetAdmin;
  return {
    id: input.id,
    source: input.source,
    target: input.target,
    level: input.level,
    offeredScopes: normalizeScopes(input.scopes),
    targetScopes: null,
    status: active ? 'active' : 'offered',
    offeredLevel: null,
    hidden: false,
    defaultWrite: false,
    offeredBy: input.by,
    acceptedBy: active ? input.by : null,
    offeredAt: input.now,
    acceptedAt: active ? input.now : null,
    updatedAt: input.now,
  };
}

/**
 * The target's admin accepts an offer, keeping all of it or only some scopes, or accepts the
 * higher level offered on an active share.
 */
export function acceptShare(
  share: Share,
  input: { by: string; sides: Sides; scopes?: readonly ShareScope[]; now: number },
): Share {
  if (!input.sides.targetAdmin) throw new ForbiddenError('Only an admin of the receiving map can accept');
  if (share.status === 'active') {
    if (!share.offeredLevel) throw new ConflictError('The share is already accepted');
    return {
      ...share,
      level: share.offeredLevel,
      offeredLevel: null,
      ...(input.scopes ? { targetScopes: narrow(share, input.scopes) } : {}),
      updatedAt: input.now,
    };
  }
  return {
    ...share,
    status: 'active',
    // An offer accepted takes the highest level offered.
    level: share.offeredLevel ?? share.level,
    offeredLevel: null,
    targetScopes: input.scopes ? narrow(share, input.scopes) : null,
    acceptedBy: input.by,
    acceptedAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * Changes a share. The source's admins set the level and the offered scopes; the target's admins
 * narrow the scopes they receive, hide the share and pick where a composite's new objects go.
 * Raising an active share to read-write waits for the target's consent unless the same person
 * administers the target too. Null when nothing changes.
 */
export function updateShare(
  share: Share,
  patch: { level?: ShareLevel; scopes?: readonly ShareScope[]; hidden?: boolean; defaultWrite?: true },
  sides: Sides,
  now: number,
): Share | null {
  const next: Share = { ...share };
  if (patch.level !== undefined && patch.level !== (share.offeredLevel ?? share.level)) {
    if (!sides.sourceAdmin)
      throw new ForbiddenError('Only an admin of the shared map changes what it allows');
    const raise = patch.level === 'read-write' && share.level === 'read';
    if (raise && share.status === 'active' && !sides.targetAdmin) next.offeredLevel = patch.level;
    else {
      next.level = patch.level;
      next.offeredLevel = null;
      // Read-only takes no writes, so it is nobody's default for new objects any more.
      if (patch.level === 'read') next.defaultWrite = false;
    }
  }
  if (patch.defaultWrite && !share.defaultWrite) {
    if (!sides.targetAdmin)
      throw new ForbiddenError('Only an admin of the receiving map picks where its new objects go');
    if (share.status !== 'active' || share.level !== 'read-write')
      throw new ConflictError('Only an accepted read-write share takes new objects');
    next.defaultWrite = true;
  }
  if (patch.hidden !== undefined && patch.hidden !== share.hidden) {
    if (!sides.targetAdmin) throw new ForbiddenError('Only an admin of the receiving map hides a share');
    next.hidden = patch.hidden;
  }
  if (patch.scopes !== undefined) {
    if (sides.sourceAdmin) {
      next.offeredScopes = normalizeScopes(patch.scopes);
      // What the target kept stays kept as far as the new offer goes.
      if (share.targetScopes) next.targetScopes = effectiveScopes(next.offeredScopes, share.targetScopes);
    } else if (sides.targetAdmin) {
      next.targetScopes = narrow(share, patch.scopes);
    } else throw new ForbiddenError();
  }
  const same =
    next.level === share.level &&
    next.offeredLevel === share.offeredLevel &&
    next.defaultWrite === share.defaultWrite &&
    next.hidden === share.hidden &&
    JSON.stringify(normalizeScopes(next.offeredScopes)) ===
      JSON.stringify(normalizeScopes(share.offeredScopes)) &&
    JSON.stringify(shareScopes(next)) === JSON.stringify(shareScopes(share));
  if (same) return null;
  return { ...next, updatedAt: now };
}

/** The target may keep less than offered, never more. */
function narrow(share: Share, scopes: readonly ShareScope[]): ShareScope[] {
  const offered = new Set(normalizeScopes(share.offeredScopes));
  const extra = scopes.filter((s) => !offered.has(s));
  if (extra.length > 0) throw new ForbiddenError(`The shared map does not offer ${extra.join(', ')}`);
  return normalizeScopes(scopes);
}

/** Either side's admins may end a share (or decline an offer). */
export function checkRevoke(sides: Sides): void {
  if (!sides.sourceAdmin && !sides.targetAdmin) throw new ForbiddenError();
}
