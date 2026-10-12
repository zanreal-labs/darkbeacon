import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

// The product's former name. Changing it would change every derived key and lock out the secrets already stored.
const HKDF_SALT = 'wormwright';

/**
 * AES-256-GCM for small secrets at rest, keyed from SECRET_KEY. `purpose` separates keys,
 * so a value sealed for one use cannot be opened as another.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(secretKey: string, purpose: string) {
    this.key = Buffer.from(hkdfSync('sha256', secretKey, HKDF_SALT, purpose, 32));
  }

  /** `v1.<iv>.<tag>.<ciphertext>`, base64url parts. */
  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), data]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  open(sealed: string): string {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('not a sealed value');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString(
      'utf8',
    );
  }
}
