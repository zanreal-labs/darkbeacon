import {
  SYSTEM_PLACEMENT,
  type ConnectionType,
  type LabelDto,
  type MapViewDto,
  type Position,
  type ShipSize,
  type SystemLabelDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { ValidationError } from '@darkbeacon/core';

/** "Home Chain #2" -> "home-chain-2". Falls back to "map" when nothing usable is left. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug.length >= 2 ? slug : 'map';
}

// SDE wormhole class ids, see UniverseSystemDto.
const C1 = 1;
const SHATTERED_FRIGATE = 13;

/**
 * Size limit a new connection starts with. Wormholes leading into C1 space only pass
 * medium hulls and shattered frigate holes only small ones; gates and bridges take anything.
 */
export function defaultShipSize(
  type: ConnectionType,
  a: UniverseSystemDto | null,
  b: UniverseSystemDto | null,
): ShipSize {
  if (type !== 'wormhole') return 'capital';
  const classes = [a?.whClass, b?.whClass];
  if (classes.includes(SHATTERED_FRIGATE)) return 'small';
  if (classes.includes(C1)) return 'medium';
  return 'large';
}

/** Spacing used to place a system that was added without a position. */
export const SYSTEM_SPACING = { x: SYSTEM_PLACEMENT.x, y: 0 };

/** Next free spot to the right of everything already placed. */
export function nextPosition(existing: readonly Position[]): Position {
  if (existing.length === 0) return { x: 0, y: 0 };
  const right = existing.reduce((best, p) => (p.x > best.x ? p : best));
  return { x: right.x + SYSTEM_SPACING.x, y: right.y + SYSTEM_SPACING.y };
}

/** Ids and names (any case) must be unique within a list. */
function validateUnique(list: ReadonlyArray<{ id: string; name: string }>, what: string): void {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const item of list) {
    if (ids.has(item.id)) throw new ValidationError(`Duplicate ${what} id ${item.id}`);
    const name = item.name.trim().toLowerCase();
    if (names.has(name)) throw new ValidationError(`Duplicate ${what} name ${item.name}`);
    ids.add(item.id);
    names.add(name);
  }
}

/** Tag ids and names must be unique within a map (Tags are `labels` in the data). */
export function validateLabels(labels: readonly LabelDto[]): void {
  validateUnique(labels, 'tag');
}

/** Label ids and names must be unique within a map: other maps match Labels by name. */
export function validateSystemLabels(labels: readonly SystemLabelDto[]): void {
  validateUnique(labels, 'label');
}

/**
 * The map's views: ids and names unique, at most one view on each quick slot (a slot is what
 * every member gets on 1, 2 or 3).
 */
export function validateMapViews(views: readonly MapViewDto[]): void {
  validateUnique(views, 'view');
  const slots = new Set<number>();
  for (const view of views) {
    if (view.slot === undefined) continue;
    if (slots.has(view.slot)) throw new ValidationError(`Two views on slot ${view.slot}`);
    slots.add(view.slot);
  }
}

/** True when `patch` would change any field of `current`. */
export function changes<T extends object>(current: T, patch: Partial<T>): boolean {
  return Object.entries(patch).some(
    ([key, value]) =>
      value !== undefined && JSON.stringify(current[key as keyof T]) !== JSON.stringify(value),
  );
}

/** Drops `undefined` entries so a partial request can be spread over an entity. */
export function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * A connection without the fields at their defaults (unlocked, no note, no lifetime mark), so
 * one that never had them reads, compares and stamps the same as before they existed.
 */
export function compactConnection<T extends { locked?: boolean; note?: string; lifetime?: unknown }>(
  c: T,
): T {
  const out = { ...c };
  if (!out.locked) delete out.locked;
  if (!out.note) delete out.note;
  if (out.lifetime == null) delete out.lifetime;
  return out;
}

/** A scan result without the fields at their defaults (a cosmic signature, not custom). */
export function compactSignature<T extends { kind?: string; custom?: boolean }>(s: T): T {
  const out = { ...s };
  if (!out.kind || out.kind === 'signature') delete out.kind;
  if (!out.custom) delete out.custom;
  return out;
}
