/**
 * Secret tokens Darkbeacon hands out (API keys, OAuth tokens), in one format that secret scanners
 * (GitHub, GitLab, trufflehog) can recognise:
 *
 *   <prefix><lookup:12><secret:32><checksum:6>
 *
 *   dbk_pat_   personal access token        dbk_svc_   service key
 *   dbk_oat_   OAuth access token (MCP)     dbk_ort_   OAuth refresh token
 *
 * All parts are base62. `lookup` (~71 bits) finds the row without scanning and is not secret;
 * `secret` (~190 bits) proves possession and is stored only as an HMAC; the checksum is CRC32 of
 * everything before it, so a scanner (or the server) tells a real token from random text without
 * asking the database.
 */
export const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const TOKEN_LOOKUP_LENGTH = 12;
export const TOKEN_SECRET_LENGTH = 32;
const CHECKSUM_LENGTH = 6;
const BODY_LENGTH = TOKEN_LOOKUP_LENGTH + TOKEN_SECRET_LENGTH + CHECKSUM_LENGTH;

/** Every token prefix, by what it is. */
export const TOKEN_PREFIX = {
  pat: 'dbk_pat_',
  svc: 'dbk_svc_',
  oauthAccess: 'dbk_oat_',
  oauthRefresh: 'dbk_ort_',
} as const;

/** A regex secret scanners can use (also in docs/api.md). */
export const SECRET_TOKEN_PATTERN = /\bdbk_(pat|svc|oat|ort)_[0-9A-Za-z]{50}\b/;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(text: string): number {
  let crc = 0xffffffff;
  for (let i = 0; i < text.length; i++) crc = CRC_TABLE[(crc ^ text.charCodeAt(i)) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function base62(value: number, length: number): string {
  let out = '';
  let n = value;
  for (let i = 0; i < length; i++) {
    out = BASE62[n % 62] + out;
    n = Math.floor(n / 62);
  }
  return out;
}

export function tokenChecksum(text: string): string {
  return base62(crc32(text), CHECKSUM_LENGTH);
}

export function formatSecretToken(prefix: string, lookup: string, secret: string): string {
  const head = `${prefix}${lookup}${secret}`;
  return `${head}${tokenChecksum(head)}`;
}

export interface ParsedSecretToken {
  prefix: string;
  lookup: string;
  secret: string;
}

/** Splits a token with one of `prefixes`; null when it is not one or its checksum does not match. */
export function parseSecretToken(token: string, prefixes: readonly string[]): ParsedSecretToken | null {
  const prefix = prefixes.find((p) => token.startsWith(p));
  if (!prefix) return null;
  const body = token.slice(prefix.length);
  if (body.length !== BODY_LENGTH || !/^[0-9A-Za-z]+$/.test(body)) return null;
  const head = token.slice(0, token.length - CHECKSUM_LENGTH);
  if (tokenChecksum(head) !== token.slice(-CHECKSUM_LENGTH)) return null;
  return {
    prefix,
    lookup: body.slice(0, TOKEN_LOOKUP_LENGTH),
    secret: body.slice(TOKEN_LOOKUP_LENGTH, TOKEN_LOOKUP_LENGTH + TOKEN_SECRET_LENGTH),
  };
}
