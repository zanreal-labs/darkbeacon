/** Keys whose values are credentials: kept out of the audit trail. */
const SECRET_KEY = /(secret|token|password|passwd|webhook|apikey|api_key|key$|credential|url$)/i;

export const HIDDEN = 'hidden';

/** A short, stable fingerprint, so a changed secret shows as changed without showing it. */
export function fingerprint(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').slice(0, 6);
}

/**
 * Settings values with secret-looking keys (tokens, passwords, webhook URLs) replaced by
 * `hidden (<fingerprint>)`; empty values stay as they are.
 */
export function redactSecrets(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      SECRET_KEY.test(key) && value !== null && value !== undefined && value !== ''
        ? `${HIDDEN} (${fingerprint(value)})`
        : value,
    ]),
  );
}

/**
 * A URL with its path and query replaced by a fingerprint: webhook URLs often carry their
 * credential (Discord, Slack), so the audit trail keeps only where they point.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const rest = `${parsed.pathname}${parsed.search}`;
    return rest === '/' ? parsed.origin : `${parsed.origin}/… (${fingerprint(rest)})`;
  } catch {
    return `${HIDDEN} (${fingerprint(url)})`;
  }
}
