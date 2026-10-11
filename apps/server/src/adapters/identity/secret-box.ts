import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';

/**
 * AES-256-GCM with a key derived (HKDF-SHA256) from SECRET_KEY for one purpose. Each purpose
 * gets its own key, so a value sealed for one use cannot be opened as another.
 * Sealed format: `v1.<iv>.<ciphertext>.<tag>`, base64url parts.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(secretKey: string, purpose: string) {
    this.key = Buffer.from(hkdfSync('sha256', secretKey, 'wormwright', purpose, 32));
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [VERSION, iv, ciphertext, cipher.getAuthTag()]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  /** The plaintext, or null when the value was tampered with or sealed with another key. */
  open(sealed: string): string | null {
    const [version, iv, ciphertext, tag] = sealed.split('.');
    if (version !== VERSION || !iv || ciphertext === undefined || !tag) return null;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return null;
    }
  }

  /** Like `open`, for values that must decrypt (stored tokens): a failure is a configuration error. */
  openOrThrow(sealed: string): string {
    const plaintext = this.open(sealed);
    if (plaintext === null) throw new Error('cannot decrypt a stored secret; was SECRET_KEY changed?');
    return plaintext;
  }
}
