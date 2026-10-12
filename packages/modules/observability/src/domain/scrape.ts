/**
 * Whether an `Authorization` header carries the scrape token (`Bearer <token>`). Compares in
 * time independent of where the strings differ, so the token cannot be guessed byte by byte.
 */
export function scrapeAuthorized(header: string | undefined, token: string): boolean {
  const match = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? '');
  const given = match?.[1]?.trim() ?? '';
  let diff = given.length ^ token.length;
  for (let i = 0; i < token.length; i++) diff |= (given.charCodeAt(i) || 0) ^ token.charCodeAt(i);
  return given.length > 0 && diff === 0;
}
