import type { SecurityOutcome } from '../../../features/account/security-client';
import {
  enrollmentNotices,
  type PasskeyEnrollment,
} from '../../auth/onboarding/passkey-enrollment';

export const OUTCOME_NOTICES: Readonly<
  Record<SecurityOutcome['kind'], string>
> = {
  ok: '',
  'stale-session':
    'This needs a recent sign-in. Sign in again with a passkey or email link, then retry.',
  'not-found': 'That credential or session was not found.',
  conflict: 'That email is already in use.',
  'rate-limited': 'Too many attempts. Wait a moment and try again.',
  invalid: 'That was not a valid request.',
  undeliverable:
    'We cannot send email to that address. Use a different address.',
  'current-undeliverable':
    'We cannot send email to the address on file, so this change cannot be approved by email.',
  unavailable: 'Something went wrong. Please try again.',
};

/** What a passkey that was not saved from this screen tells the person. */
export const ENROLMENT_NOTICES: Readonly<
  Record<Exclude<PasskeyEnrollment['kind'], 'saved'>, string>
> = {
  unavailable: 'Saving a passkey is not available on this device.',
  cancelled: 'Nothing was saved.',
  'stale-session': enrollmentNotices['stale-session'],
  failed: 'We could not save a passkey. Please try again.',
};

export function formatDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}
