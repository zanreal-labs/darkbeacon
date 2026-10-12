/**
 * Merging an imported object into one the map has already, field by field.
 *
 * With a base (what the last import from the same source wrote) it is a three-way merge: a field
 * Wanderer did not change since is left alone, a field only Wanderer changed is taken, and a
 * field both sides changed goes to the newer side. Without a base (first import into an existing
 * map): blanks here are filled, blanks in Wanderer change nothing, and differing values go to the
 * newer side. Notes are never lost: when both sides wrote different notes, Wanderer's are added
 * below the ones here. Nothing is ever removed by a merge.
 */

export interface FieldConflict {
  field: string;
  here: unknown;
  wanderer: unknown;
  keeps: 'here' | 'wanderer';
  why: string;
}

export interface MergeInput<T extends object> {
  here: T;
  wanderer: T;
  /** What the last import wrote, or null on a first import. */
  base: T | null;
  /** When the object here last changed. */
  hereAt: number;
  /** When Wanderer last changed it; null when unknown (then the map's side wins). */
  wandererAt: number | null;
  fields: ReadonlyArray<keyof T & string>;
  /** Fields whose two different texts are joined (lists: united) instead of one winning. */
  joined?: ReadonlyArray<keyof T & string>;
  /** Fields Wanderer may not change here, with the reason (a locked system's position). */
  protect?: Partial<Record<keyof T & string, string>>;
  /** Whether a value counts as empty (fill it from the other side). */
  blank?: (field: keyof T & string, value: unknown) => boolean;
}

export interface MergeResult<T> {
  patch: Partial<T>;
  conflicts: FieldConflict[];
}

const MAX_JOINED = 10_000;

export function mergeFields<T extends object>(input: MergeInput<T>): MergeResult<T> {
  const { here, wanderer, base, fields } = input;
  const blank = input.blank ?? defaultBlank;
  const patch: Partial<T> = {};
  const conflicts: FieldConflict[] = [];
  const newer: 'here' | 'wanderer' =
    input.wandererAt !== null && input.wandererAt > input.hereAt ? 'wanderer' : 'here';
  const newerWhy =
    input.wandererAt === null
      ? 'Wanderer did not say when it changed, so the map keeps its value'
      : newer === 'wanderer'
        ? 'Changed later in Wanderer'
        : 'Changed later here';

  for (const field of fields) {
    const h = here[field];
    const w = wanderer[field];
    if (same(h, w)) continue;
    const protectedWhy = input.protect?.[field];
    const take = (why?: string) => {
      if (protectedWhy) {
        conflicts.push({ field, here: h, wanderer: w, keeps: 'here', why: protectedWhy });
        return;
      }
      patch[field] = w;
      if (why) conflicts.push({ field, here: h, wanderer: w, keeps: 'wanderer', why });
    };

    if (base) {
      const b = base[field];
      const wandererChanged = !same(w, b);
      const hereChanged = !same(h, b);
      if (!wandererChanged) continue;
      if (!hereChanged) {
        take();
        continue;
      }
    } else {
      if (blank(field, w)) continue;
      if (blank(field, h)) {
        take();
        continue;
      }
    }
    // Both sides have their own value.
    if (protectedWhy) {
      conflicts.push({ field, here: h, wanderer: w, keeps: 'here', why: protectedWhy });
      continue;
    }
    if (input.joined?.includes(field) && Array.isArray(h) && Array.isArray(w)) {
      const union = [...new Set([...(h as unknown[]), ...(w as unknown[])])];
      if (!protectedWhy && union.length !== h.length) {
        patch[field] = union as T[typeof field];
        conflicts.push({
          field,
          here: h,
          wanderer: w,
          keeps: 'wanderer',
          why: 'Both sides have some; the map keeps all of them',
        });
      }
      continue;
    }
    if (input.joined?.includes(field) && typeof h === 'string' && typeof w === 'string') {
      const joined = join(h, w, base ? (base[field] as unknown) : null);
      if (joined !== h) {
        if (protectedWhy) continue;
        patch[field] = joined as T[typeof field];
        conflicts.push({
          field,
          here: h,
          wanderer: w,
          keeps: 'wanderer',
          why: "Both sides wrote notes; Wanderer's were added below",
        });
      }
      continue;
    }
    if (newer === 'wanderer') take(newerWhy);
    else conflicts.push({ field, here: h, wanderer: w, keeps: 'here', why: newerWhy });
  }
  return { patch, conflicts };
}

/** Here's text with Wanderer's added below, unless it is already in there. */
function join(here: string, wanderer: string, base: unknown): string {
  if (here.includes(wanderer.trim())) return here;
  // What the last import wrote is replaced in place by Wanderer's new text rather than piled up.
  const joined =
    typeof base === 'string' && base && here.includes(base)
      ? here.replace(base, wanderer.trim())
      : `${here}\n\n${wanderer.trim()}`;
  return joined.length > MAX_JOINED ? `${joined.slice(0, MAX_JOINED - 1)}…` : joined;
}

function defaultBlank(_field: string, value: unknown): boolean {
  return (
    value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
  );
}

export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
