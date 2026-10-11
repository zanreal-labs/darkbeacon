import { v7, validate, version } from 'uuid';

/** New time-ordered identifier (UUID v7). Sorts by creation time as a plain string. */
export function newId(): string {
  return v7();
}

export function isId(value: unknown): value is string {
  return typeof value === 'string' && validate(value) && version(value) === 7;
}
