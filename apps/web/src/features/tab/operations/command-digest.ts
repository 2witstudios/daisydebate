import { createHash } from 'node:crypto';

/**
 * A Tab command's payload digest, the SHA3-256 hex of its JSON. The value
 * is the envelope's parsed `expected` and `command`, whose keys the
 * protocol schemas emit in one order, so the same payload always digests
 * the same.
 */
export const commandDigest = (value: unknown): string =>
  createHash('sha3-256').update(JSON.stringify(value)).digest('hex');
