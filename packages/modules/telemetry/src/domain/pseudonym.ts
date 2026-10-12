/** HMAC-SHA256 of `data` under `secret`, as lowercase hex (provided by an adapter). */
export type HmacSha256 = (secret: string, data: string) => string;

/**
 * The distinct id of an account in telemetry: an HMAC-SHA256 of the account id under this
 * instance's own random secret, truncated to 128 bits. Stable within the instance (so daily and
 * monthly actives can be told apart), different on every other instance, and not reversible
 * without the secret, which never leaves the database.
 */
export function pseudonymousId(hmac: HmacSha256, secret: string, accountId: string): string {
  return `u_${hmac(secret, `account:${accountId}`).slice(0, 32)}`;
}
