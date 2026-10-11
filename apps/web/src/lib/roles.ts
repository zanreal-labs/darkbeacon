import type { MapRole } from '@wormwright/shared';

const RANK: Record<MapRole, number> = { blocked: 0, viewer: 1, member: 2, manager: 3, admin: 4 };

/** True when `role` grants at least `required`. */
export function atLeast(role: MapRole | null | undefined, required: MapRole): boolean {
  return role != null && RANK[role] >= RANK[required];
}

/** What the current user may do on a map. The server checks again; the UI only hides. */
export interface MapPermissions {
  role: MapRole | null;
  /** Add, move, edit and remove systems, connections and signatures. */
  edit: boolean;
  /** Lock systems and edit labels. */
  manage: boolean;
  /** Map settings and access rules. */
  admin: boolean;
}

export function mapPermissions(role: MapRole | null | undefined): MapPermissions {
  return {
    role: role ?? null,
    edit: atLeast(role, 'member'),
    manage: atLeast(role, 'manager'),
    admin: atLeast(role, 'admin'),
  };
}
