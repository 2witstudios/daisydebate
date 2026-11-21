import { commandDigest } from '@daisy/digest';
/** Version and operation bind a normalized social payload; no body is stored. */
export const messagingSocialDigest = (
  operation: string,
  values: readonly unknown[],
) => commandDigest([1, operation, ...values]);
