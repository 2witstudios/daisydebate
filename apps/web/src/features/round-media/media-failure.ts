import type { MediaConnectionState } from './media-controller';

/** What a media failure means for the connection. Pure; effects stay in the controller. */
/** The transport's error for a device the Room check passed that is now gone. */
export const CHECKED_DEVICE_MISSING = 'CheckedDeviceMissingError';

const transient = new WeakSet<object>();
/**
 * A media request refused for now (a 503 under load, or the network): the
 * controller retries it before calling media unavailable (ISSUE-494).
 */
export function transientMediaFailure() {
  const failure = new Error('Media unavailable for now');
  transient.add(failure);
  return failure;
}
export const isTransientMediaFailure = (error: unknown) =>
  typeof error === 'object' && error !== null && transient.has(error);
/** The only answers that bear on whether this caller may keep its media. */
const AUTHORITY_REFUSALS = [401, 403, 404, 409, 410];
const REFUSED = 'MediaRefusedError';
export const mediaRefusal = () => {
  const refusal = new Error('Media unavailable');
  refusal.name = REFUSED;
  return refusal;
};
export const isMediaRefusal = (error: unknown) =>
  error instanceof Error && error.name === REFUSED;
/**
 * The failure a non-OK media answer stands for: a 408 (the outcome is unknown)
 * or a 503 (refused for now) is transient and retried. Only an authority refusal
 * ends a live connection; any other status leaves its tracks up.
 */
export function mediaFailure(status: number) {
  if (status === 408 || status === 503) return transientMediaFailure();
  return AUTHORITY_REFUSALS.includes(status)
    ? mediaRefusal()
    : new Error('Media unavailable');
}

const deviceBlocked = (error: unknown) =>
  error instanceof Error &&
  [
    'NotAllowedError',
    'SecurityError',
    'NotFoundError',
    'NotReadableError',
  ].includes(error.name);

/** Whether a failure may pass by itself; a recovery owner reads this from `changed`. */
export type MediaFailureKind = 'transient' | 'definite';
export const failureKind = (error: unknown): MediaFailureKind =>
  isTransientMediaFailure(error) ? 'transient' : 'definite';

export const failureState = (error: unknown): MediaConnectionState => {
  if (error instanceof Error && error.name === CHECKED_DEVICE_MISSING)
    return 'device-missing';
  return deviceBlocked(error) ? 'device-blocked' : 'unavailable';
};
