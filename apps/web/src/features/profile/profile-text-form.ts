import { BIO_MAX, DISPLAY_NAME_MAX } from '@daisy/protocol/public-profile';
import { refused, type Refused } from '../forms/form-state';
import type { SaveFormState } from '../forms/save-form';

/**
 * The display name and bio form's answer (ADR 0142): a settings form that
 * saves in place, whose refusal renders the typed text again beside what to
 * do about it.
 */
export type ProfileTextFormState = SaveFormState;

/** Why a save of the text did not land, each one thing to tell the member. */
export type ProfileTextRefusal =
  'too-long' | 'rate-limited' | 'not-allowed' | 'unavailable';

export const profileTextRefusalCopy: Readonly<
  Record<ProfileTextRefusal, string>
> = {
  'too-long': `A display name is at most ${DISPLAY_NAME_MAX} characters and a bio at most ${BIO_MAX}.`,
  'rate-limited': 'Too many changes at once. Try again in a minute.',
  'not-allowed': 'Your account can’t change its profile right now.',
  unavailable: 'Could not save. Try again.',
};

/** The refusal a refused save's status names. */
export const profileTextRefusalOf = (status: number): ProfileTextRefusal => {
  if (status === 400) return 'too-long';
  if (status === 429) return 'rate-limited';
  if (status === 403) return 'not-allowed';
  return 'unavailable';
};

export const profileTextRefused = (
  form: FormData,
  refusal: ProfileTextRefusal,
): Refused => refused(form, profileTextRefusalCopy[refusal]);

/** Not saved because the post never reached the server, or its answer was lost. */
export const profileTextUnavailable = (form: FormData): Refused =>
  profileTextRefused(form, 'unavailable');

/** What a person sees as one character: a code point, as the server counts. */
export const characterCount = (text: string): number => [...text].length;
