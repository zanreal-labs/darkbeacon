/**
 * A second line behind the catalogue's schemas: values that look like something personal are
 * refused even if a schema were ever loosened by mistake. Strings must be short tokens (enum
 * values, buckets, versions); numbers must be small counts, so EVE ids (characters, systems,
 * corporations: eight digits and more) and Discord ids can never pass as a number either.
 */
const TOKEN = /^[a-z0-9_.:+<>-]{1,32}$/;
const EMAIL = /[^\s@]+@[^\s@]+/;
const IPV4 = /(?:\d{1,3}\.){3}\d{1,3}/;
const IPV6 = /(?:[0-9a-f]{1,4}:){2,}[0-9a-f]{0,4}/i;
const LONG_NUMBER = /\d{6,}/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}/i;
/** Larger than any count an instance reports; EVE ids start well above it. */
export const MAX_TELEMETRY_NUMBER = 10_000_000;

/** Why `value` may not be sent, or null when it may. */
export function piiProblem(value: unknown, path = 'value'): string | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || Math.abs(value) > MAX_TELEMETRY_NUMBER) {
      return `${path}: numbers must be small whole counts`;
    }
    return null;
  }
  if (typeof value === 'string') {
    if (EMAIL.test(value)) return `${path}: looks like an email address`;
    if (IPV4.test(value) || IPV6.test(value)) return `${path}: looks like an IP address`;
    if (LONG_NUMBER.test(value)) return `${path}: looks like an id`;
    if (UUID.test(value)) return `${path}: looks like an id`;
    if (!TOKEN.test(value)) return `${path}: only short enum values are allowed`;
    return null;
  }
  if (Array.isArray(value)) {
    if (value.length > 20) return `${path}: too many values`;
    for (const [i, item] of value.entries()) {
      const problem = piiProblem(item, `${path}[${i}]`);
      if (problem) return problem;
    }
    return null;
  }
  return `${path}: only enums, booleans and counts are allowed`;
}
