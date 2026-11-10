import { isAppError } from '@daisy/errors';
import { causeChainMember } from './capacity-refusal';

/**
 * How long any service lease, web or realtime, stays current after its
 * renewal is stamped (ADR 0033 §7). `requireCurrentWeb` refuses a web
 * instance past it, and the availability sampler counts a peer of either
 * role live only within it. A renewal that took longer than this to settle
 * proves nothing: its stamp may already have lapsed.
 */
export const SERVICE_LEASE_WINDOW_MS = 3000;

/**
 * The refusal `requireCurrentWeb` raises when this web instance's own service
 * lease is not current (DAISY-WEB-9), recognised by its reason, never its
 * message, also through bounded native cause wrappers (as `isCapacityRefusal`
 * is), so a worker that wraps a store error still logs the lapse as a
 * warning. It imports only `@daisy/errors`, like `@daisy/db/capacity`, so a
 * caller can classify the refusal without loading the driver or schema.
 */
export const isServiceLeaseLapse = (error: unknown): boolean =>
  causeChainMember(
    (candidate) =>
      isAppError(candidate) && candidate.reason === 'service-lease-lapsed',
    error,
  ) !== undefined;
