import type { Actor, GrantingMapRole, MapRole } from '../authorization.js';
import { ForbiddenError, NotFoundError, UnauthenticatedError } from '../errors.js';
import { hasMapRole } from '../authorization.js';

/**
 * Answers "what may this actor do on this map". Implemented by the access module,
 * consumed by every module that touches maps.
 */
export interface MapAccess {
  /** The actor's effective role on the map, or null when the map does not exist or grants nothing. */
  roleOf(actor: Actor, mapId: string): Promise<MapRole | null>;
  /** Maps the actor can at least view, with the effective role. */
  mapsFor(actor: Actor): Promise<Array<{ mapId: string; role: GrantingMapRole }>>;
}

/**
 * Throws unless the actor has at least `min` on the map. A map the actor cannot even view
 * is reported as not found, so map ids do not leak.
 */
export async function requireMapRole(
  access: MapAccess,
  actor: Actor | null,
  mapId: string,
  min: GrantingMapRole,
): Promise<MapRole> {
  if (!actor) throw new UnauthenticatedError();
  const role = await access.roleOf(actor, mapId);
  if (!hasMapRole(role, 'viewer')) throw new NotFoundError('Map');
  if (!hasMapRole(role, min)) throw new ForbiddenError();
  return role as MapRole;
}
