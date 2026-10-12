import {
  BASE62,
  SECRET_TOKEN_PATTERN,
  TOKEN_LOOKUP_LENGTH,
  TOKEN_PREFIX,
  TOKEN_SECRET_LENGTH,
  crc32,
  formatSecretToken,
  parseSecretToken,
  type ApiKeyKind,
} from '@darkbeacon/shared';

/**
 * API key tokens: `dbk_pat_…` (personal access token) and `dbk_svc_…` (service key), in the
 * format of `@darkbeacon/shared`'s `tokens.ts` (prefix, 12 lookup, 32 secret and 6 checksum
 * characters, base62).
 */
export const TOKEN_PREFIXES: Record<ApiKeyKind, string> = { pat: TOKEN_PREFIX.pat, svc: TOKEN_PREFIX.svc };
export const LOOKUP_LENGTH = TOKEN_LOOKUP_LENGTH;
export const SECRET_LENGTH = TOKEN_SECRET_LENGTH;
export { BASE62, crc32 };

/** A regex secret scanners can use (also in docs/api.md). */
export const TOKEN_PATTERN = SECRET_TOKEN_PATTERN;

export function formatToken(kind: ApiKeyKind, lookup: string, secret: string): string {
  return formatSecretToken(TOKEN_PREFIXES[kind], lookup, secret);
}

export interface ParsedToken {
  kind: ApiKeyKind;
  lookup: string;
  secret: string;
}

/** Splits a token; null when it is not an API key or its checksum does not match. */
export function parseToken(token: string): ParsedToken | null {
  const parsed = parseSecretToken(token, Object.values(TOKEN_PREFIXES));
  if (!parsed) return null;
  const kind = (Object.keys(TOKEN_PREFIXES) as ApiKeyKind[]).find(
    (k) => TOKEN_PREFIXES[k] === parsed.prefix,
  )!;
  return { kind, lookup: parsed.lookup, secret: parsed.secret };
}

/** What the UI shows to recognise a key: the prefix and its lookup part, never the secret. */
export function displayPrefix(kind: ApiKeyKind, lookup: string): string {
  return `${TOKEN_PREFIXES[kind]}${lookup.slice(0, 6)}…`;
}
