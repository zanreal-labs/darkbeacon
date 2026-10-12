import type { AuditFieldChange } from '@darkbeacon/shared';

export type Fields = Record<string, unknown>;
export type FieldDiff = Record<string, AuditFieldChange>;

/** JSON with sorted keys, so equal values compare equal whatever the key order. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Fields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export function sameValue(a: unknown, b: unknown): boolean {
  return canonical(a ?? null) === canonical(b ?? null);
}

export function asFields(value: unknown): Fields | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Fields) : null;
}

/**
 * Field-level changes from `before` to `after` (top-level fields; nested values such as a
 * position compare as a whole). Missing values read as null. `ignore` drops bookkeeping fields.
 */
export function fieldDiff(before: unknown, after: unknown, ignore: readonly string[] = []): FieldDiff {
  const b = asFields(before) ?? {};
  const a = asFields(after) ?? {};
  const diff: FieldDiff = {};
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (ignore.includes(key)) continue;
    if (sameValue(b[key], a[key])) continue;
    diff[key] = { before: b[key] ?? null, after: a[key] ?? null };
  }
  return diff;
}

/** The fields of a removed or created object without the ignored ones. */
export function snapshot(value: unknown, ignore: readonly string[] = []): Fields | null {
  const fields = asFields(value);
  if (!fields) return null;
  return Object.fromEntries(Object.entries(fields).filter(([key]) => !ignore.includes(key)));
}
