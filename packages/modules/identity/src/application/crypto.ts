// Random tokens and hashes through the platform's Web Crypto, so the module stays free of node: imports.

const webCrypto = globalThis.crypto;

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Unguessable token, base64url encoded. */
export function randomToken(bytes = 32): string {
  return base64url(webCrypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(text: string): Promise<string> {
  const digest = await webCrypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return base64url(new Uint8Array(digest));
}

/** PKCE S256 code challenge of a verifier (RFC 7636). */
export function pkceChallenge(verifier: string): Promise<string> {
  return sha256(verifier);
}

/** Compares two strings without leaking where they differ. */
export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
