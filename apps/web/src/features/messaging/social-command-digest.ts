import { createHash } from 'node:crypto';
/** Version and operation bind a normalized social payload; no body is stored. */
export const messagingSocialDigest = (
  operation: string,
  values: readonly unknown[],
) =>
  createHash('sha3-256')
    .update(JSON.stringify([1, operation, ...values]))
    .digest('hex');
