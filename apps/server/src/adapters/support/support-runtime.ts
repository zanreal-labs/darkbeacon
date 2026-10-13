import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SupportCrypto, SupportLimiter } from '@darkbeacon/support';
import type { TokenBuckets } from '../rate-limit/token-buckets.js';

export const nodeSupportCrypto: SupportCrypto = {
  randomToken: (bytes) => randomBytes(bytes).toString('base64url'),
  sha256Hex: (value) => createHash('sha256').update(value, 'utf8').digest('hex'),
  uuid: () => randomUUID(),
};

/** `limit` per `perMinutes` as a token bucket that holds `limit` at most. */
export function bucketLimiter(buckets: TokenBuckets): SupportLimiter {
  return {
    take: (key, limit, perMinutes) => buckets.take(key, limit / perMinutes, 1, limit).ok,
  };
}
