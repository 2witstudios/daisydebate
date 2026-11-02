import type { RequestFailure } from './model/media-events';

/** What a media failure means for the connection. Pure; effects stay in the controller. */

const transient = new WeakSet<object>();
/**
 * A media request that may succeed unchanged (a 429 or 5xx, or the network): the
 * controller retries it before calling media unavailable (ISSUE-494).
 */
export function transientMediaFailure() {
  const failure = new Error('Media unavailable for now');
  transient.add(failure);
  return failure;
}
/** Answers no attempt from this page can change; a new page may. */
const FINAL_REFUSALS = [401, 403, 404, 410];
const FOR_NOW = [408, 429, 500, 502, 503, 504];
const endsConnection = new WeakSet<object>();
const finalForPage = new WeakSet<object>();
/** An answer about authority: it ends the connection, and a person may ask again. */
const mediaRefusal = () => {
  const refusal = new Error('Media unavailable');
  endsConnection.add(refusal);
  return refusal;
};
const finalMediaRefusal = () => {
  const refusal = mediaRefusal();
  finalForPage.add(refusal);
  return refusal;
};
/**
 * The one classifier of a non-OK media answer. A 408, 429 or 5xx is transient and
 * retried. Only a refusal ends a live connection; any other status (a 400, say)
 * leaves its tracks up but will not pass by itself.
 */
export function mediaFailure(status: number) {
  if (FOR_NOW.includes(status)) return transientMediaFailure();
  if (FINAL_REFUSALS.includes(status)) return finalMediaRefusal();
  return status === 409 ? mediaRefusal() : new Error('Media unavailable');
}

/**
 * The kind the model reads. A reply that does not parse, or names another Round, is
 * `definite`: retrying cannot help. Error names confer nothing.
 */
export const requestFailureOf = (error: unknown): RequestFailure => {
  if (typeof error !== 'object' || error === null) return 'definite';
  if (finalForPage.has(error)) return 'refused';
  if (endsConnection.has(error)) return 'ending';
  return transient.has(error) ? 'transient' : 'definite';
};
