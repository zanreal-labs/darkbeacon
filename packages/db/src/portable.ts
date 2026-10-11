/**
 * Helpers that keep one schema working on SQLite and Postgres:
 * JSON as text, timestamps as epoch ms, booleans as 0/1.
 */

/** Column types to use in migrations. */
export const col = {
  /** uuid v7 or other string ids. */
  id: 'text',
  text: 'text',
  integer: 'integer',
  /** Epoch milliseconds. Postgres `integer` is 32-bit, so timestamps need bigint. */
  timestamp: 'bigint',
  /** EVE ids (characters, corporations, systems, types); some exceed 32 bits. */
  eveId: 'bigint',
  real: 'double precision',
  /** 0/1 */
  boolean: 'integer',
  /** JSON encoded as text. */
  json: 'text',
} as const;

export const json = {
  encode(value: unknown): string {
    return JSON.stringify(value);
  },
  decode<T>(text: string | null | undefined): T | null {
    return text == null ? null : (JSON.parse(text) as T);
  },
};

export const bool = {
  encode(value: boolean): 0 | 1 {
    return value ? 1 : 0;
  },
  decode(value: number | boolean | null | undefined): boolean {
    return value === 1 || value === true;
  },
};

export function epochMs(value: Date | number): number {
  return typeof value === 'number' ? value : value.getTime();
}

/** True for a unique or primary key violation on either dialect. */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === '23505' || code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
}
