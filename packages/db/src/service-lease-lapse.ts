import { isAppError } from '@daisy/errors';

/**
 * How long a web service lease stays current after its renewal is stamped
 * (ADR 0033 §7). `requireCurrentWeb` refuses past it; a renewal that took
 * longer than this to settle committed a lease that had already lapsed.
 */
export const SERVICE_LEASE_WINDOW_MS = 3000;

/**
 * The refusal `requireCurrentWeb` raises when this web instance's own service
 * lease is not current (DAISY-WEB-9), recognised by its reason, never its
 * message. It imports only `@daisy/errors`, like `@daisy/db/capacity`, so a
 * caller can classify the refusal without loading the driver or schema.
 */
export const isServiceLeaseLapse = (error: unknown): boolean =>
  isAppError(error) && error.reason === 'service-lease-lapsed';
