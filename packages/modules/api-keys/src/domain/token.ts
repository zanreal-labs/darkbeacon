import type { ApiKeyKind } from '@darkbeacon/shared';

/**
 * Token format, friendly to secret scanners (GitHub, GitLab, trufflehog):
 *
 *   dbk_pat_<lookup:12><secret:32><checksum:6>     personal access token
 *   dbk_svc_<lookup:12><secret:32><checksum:6>     service key
 *
 * All parts are base62. `lookup` (~71 bits) finds the row without scanning and is not secret;
 * `secret` (~190 bits) is what proves possession and is stored only as an HMAC; the checksum is
 * CRC32 of everything before it, so a scanner (or the server) can tell a real token from random
 * text without asking the database.
 */
export const TOKEN_PREFIXES: Record<ApiKeyKind, string> = { pat: 'dbk_pat_', svc: 'dbk_svc_' };
export const LOOKUP_LENGTH = 12;
export const SECRET_LENGTH = 32;
const CHECKSUM_LENGTH = 6;
const BODY_LENGTH = LOOKUP_LENGTH + SECRET_LENGTH + CHECKSUM_LENGTH;
export const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A regex secret scanners can use (also in docs/api.md). */
export const TOKEN_PATTERN = /\bdbk_(pat|svc)_[0-9A-Za-z]{50}\b/;

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

export function checksum(text: string): string {
  return base62(crc32(text), CHECKSUM_LENGTH);
}

export function formatToken(kind: ApiKeyKind, lookup: string, secret: string): string {
  const head = `${TOKEN_PREFIXES[kind]}${lookup}${secret}`;
  return `${head}${checksum(head)}`;
}

export interface ParsedToken {
  kind: ApiKeyKind;
  lookup: string;
  secret: string;
}

/** Splits a token; null when it is not one of ours or its checksum does not match. */
export function parseToken(token: string): ParsedToken | null {
  const kind = (Object.keys(TOKEN_PREFIXES) as ApiKeyKind[]).find((k) => token.startsWith(TOKEN_PREFIXES[k]));
  if (!kind) return null;
  const body = token.slice(TOKEN_PREFIXES[kind].length);
  if (body.length !== BODY_LENGTH || !/^[0-9A-Za-z]+$/.test(body)) return null;
  const head = token.slice(0, token.length - CHECKSUM_LENGTH);
  if (checksum(head) !== token.slice(-CHECKSUM_LENGTH)) return null;
  return {
    kind,
    lookup: body.slice(0, LOOKUP_LENGTH),
    secret: body.slice(LOOKUP_LENGTH, LOOKUP_LENGTH + SECRET_LENGTH),
  };
}

/** What the UI shows to recognise a key: the prefix and its lookup part, never the secret. */
export function displayPrefix(kind: ApiKeyKind, lookup: string): string {
  return `${TOKEN_PREFIXES[kind]}${lookup.slice(0, 6)}…`;
}
