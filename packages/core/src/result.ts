/**
 * Result is for pure functions whose failure is a normal outcome (parsers, domain rules).
 * Use cases throw DomainError instead, so controllers stay thin.
 */
export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw new Error(`unwrap on error result: ${String(result.error)}`);
}
