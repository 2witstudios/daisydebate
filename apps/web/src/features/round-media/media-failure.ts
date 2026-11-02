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
export const isTransientMediaFailure = (error: unknown) =>
  typeof error === 'object' && error !== null && transient.has(error);
/** Answers no attempt from this page can change; a new page may. */
const FINAL_REFUSALS = [401, 403, 404, 410];
const FOR_NOW = [408, 429, 500, 502, 503, 504];
const endsConnection = new WeakSet<object>();
const finalForPage = new WeakSet<object>();
/** An answer about authority: it ends the connection, and a person may ask again. */
export const mediaRefusal = () => {
  const refusal = new Error('Media unavailable');
  endsConnection.add(refusal);
  return refusal;
};
const finalMediaRefusal = () => {
  const refusal = mediaRefusal();
  finalForPage.add(refusal);
  return refusal;
};
export const endsMediaConnection = (error: unknown) =>
  typeof error === 'object' && error !== null && endsConnection.has(error);
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
 * Whether a failure may pass by itself, read by the recovery owner from `changed`.
 * `refused` is final for this page; `definite` waits for a person's Retry. A reply
 * that does not parse, or names another Round, is `definite`: retrying cannot help.
 * `replaced` means this seat connected elsewhere, and Retry would take it back.
 */
export type MediaFailureKind =
  'transient' | 'definite' | 'refused' | 'replaced';
const replaced = new WeakSet<object>();
/** This seat connected from elsewhere: no attempt from here can help unasked. */
export const seatReplaced = () => {
  const failure = new Error('Media unavailable');
  replaced.add(failure);
  return failure;
};
export const failureKind = (error: unknown): MediaFailureKind => {
  if (typeof error === 'object' && error !== null && replaced.has(error))
    return 'replaced';
  if (typeof error === 'object' && error !== null && finalForPage.has(error))
    return 'refused';
  return isTransientMediaFailure(error) ? 'transient' : 'definite';
};
