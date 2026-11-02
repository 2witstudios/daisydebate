import { isCapacityRefusal } from '@daisy/db/capacity';
import { createAppError, isAppError } from '@daisy/errors';

/** A read that did not answer; `temporary` when asking again can help. */
export type UnavailableRead = {
  readonly kind: 'unavailable';
  readonly temporary?: true;
};

/**
 * A 503 is the route's retryable INFRASTRUCTURE, which a capacity refusal
 * becomes (ADR 0088 §4). A refusal's work never ran, so state is intact. Any
 * other failure, or an answer this build cannot read, is not known to pass.
 */
export const unavailableRead = (response?: Response): UnavailableRead =>
  response?.status === 503
    ? { kind: 'unavailable', temporary: true }
    : { kind: 'unavailable' };

/** What a page throws for a read it cannot render from. */
export const unreadable = (read: { readonly temporary?: true }) =>
  createAppError(read.temporary ? 'INFRASTRUCTURE' : 'INTERNAL');

/**
 * A failure a server-rendered page may answer with a temporary state. Both
 * tests are needed: a page's own error passes `isAppError`, but `@daisy/errors`
 * is bundled per entry, so a refusal the database threw is recognised only by
 * `isCapacityRefusal`, whose package stays external. Next's redirect and
 * not-found errors are neither.
 */
export const isTemporaryReadFailure = (error: unknown): boolean =>
  isCapacityRefusal(error) ||
  (isAppError(error) && error.code === 'INFRASTRUCTURE');
