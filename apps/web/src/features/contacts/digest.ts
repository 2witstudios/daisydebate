import { createHash } from 'node:crypto';

/** Contacts' command digest: version and operation bind the normalized payload. */
export const contactCommandDigest = (
  operation: string,
  values: readonly unknown[],
) =>
  createHash('sha3-256')
    .update(JSON.stringify([1, operation, ...values]))
    .digest('hex');
