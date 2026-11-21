import { commandDigest } from '@daisy/digest';

/** Contacts' command digest: version and operation bind the normalized payload. */
export const contactCommandDigest = (
  operation: string,
  values: readonly unknown[],
) => commandDigest([1, operation, ...values]);
