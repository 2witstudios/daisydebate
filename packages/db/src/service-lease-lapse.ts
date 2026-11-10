import { isAppError } from '@daisy/errors';

/**
 * The refusal `requireCurrentWeb` raises when this web instance's own service
 * lease is not current (DAISY-WEB-9), recognised by its reason, never its
 * message. It imports only `@daisy/errors`, like `@daisy/db/capacity`, so a
 * caller can classify the refusal without loading the driver or schema.
 */
export const isServiceLeaseLapse = (error: unknown): boolean =>
  isAppError(error) && error.reason === 'service-lease-lapsed';
