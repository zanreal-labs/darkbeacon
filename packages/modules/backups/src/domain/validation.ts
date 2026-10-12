import { ValidationError } from '@darkbeacon/core';

/** Tables every Darkbeacon database has; a file without them is something else. */
export const REQUIRED_TABLES = [
  'kysely_migration',
  'event_log',
  'event_stream',
  'account',
  'session',
  'maps',
] as const;

/** What a database file holds, read without changing it. */
export interface DatabaseInspection {
  /** `PRAGMA integrity_check`: `['ok']` for a healthy file. */
  integrity: string[];
  tables: string[];
  /** Applied migrations. */
  migrations: string[];
}

export type RestoreProblem =
  | { kind: 'damaged'; detail: string }
  | { kind: 'foreign'; missing: string[] }
  | { kind: 'newer'; unknown: string[] };

/** Why a database must not be restored on this code, or null when it may. */
export function restoreProblem(
  inspection: DatabaseInspection,
  knownMigrations: readonly string[],
): RestoreProblem | null {
  if (inspection.integrity.length !== 1 || inspection.integrity[0] !== 'ok') {
    return { kind: 'damaged', detail: inspection.integrity.slice(0, 3).join('; ') || 'no answer' };
  }
  const missing = REQUIRED_TABLES.filter((t) => !inspection.tables.includes(t));
  if (missing.length > 0) return { kind: 'foreign', missing };
  const known = new Set(knownMigrations);
  const unknown = inspection.migrations.filter((m) => !known.has(m));
  if (unknown.length > 0) return { kind: 'newer', unknown };
  return null;
}

export function describeProblem(problem: RestoreProblem): string {
  switch (problem.kind) {
    case 'damaged':
      return `The file is damaged (integrity check: ${problem.detail}).`;
    case 'foreign':
      return `This is not a Darkbeacon database (missing ${problem.missing.join(', ')}).`;
    case 'newer':
      return `This backup comes from a newer Darkbeacon (${problem.unknown.length} unknown migration${
        problem.unknown.length === 1 ? '' : 's'
      }, e.g. ${problem.unknown[0]}). Update this server first, then restore it.`;
  }
}

/** Throws a ValidationError (400) saying why the file cannot be restored. */
export function assertRestorable(inspection: DatabaseInspection, knownMigrations: readonly string[]): void {
  const problem = restoreProblem(inspection, knownMigrations);
  if (problem) throw new ValidationError(describeProblem(problem), { reason: problem.kind });
}
