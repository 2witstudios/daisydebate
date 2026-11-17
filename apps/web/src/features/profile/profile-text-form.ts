import {
  BIO_MAX,
  DISPLAY_NAME_MAX,
  profileTextRefusals,
  type ProfileTextRefusal as TextRefusalWord,
} from '@daisy/protocol/public-profile';
import { refused, type Refused } from '../forms/form-state';
import type { SaveFormState } from '../forms/save-form';

/**
 * The display name and bio form's answer (ADR 0143): a settings form that
 * saves in place, whose refusal renders the typed text again beside what to
 * do about it.
 */
export type ProfileTextFormState = SaveFormState;

/**
 * Why a save of the text did not land, each one thing to tell the member: the
 * route's closed words for the text itself, then the answers any route gives.
 */
export type ProfileTextRefusal =
  TextRefusalWord | 'rate-limited' | 'not-allowed' | 'unavailable';

export const profileTextRefusalCopy: Readonly<
  Record<ProfileTextRefusal, string>
> = {
  'display-name-too-long': `A display name is at most ${DISPLAY_NAME_MAX} characters.`,
  'display-name-handle':
    'A display name can’t contain @: it would look like a username.',
  'bio-too-long': `A bio is at most ${BIO_MAX} characters.`,
  'rate-limited': 'Too many changes at once. Try again in a minute.',
  'not-allowed': 'Your account can’t change its profile right now.',
  unavailable: 'Could not save. Try again.',
};

const isTextRefusalWord = (value: unknown): value is TextRefusalWord =>
  (profileTextRefusals as readonly unknown[]).includes(value);

/** The refusal a refused save names: its closed word, else its status. */
export const profileTextRefusalOf = (answer: {
  readonly status: number;
  readonly refusal: unknown;
}): ProfileTextRefusal => {
  if (isTextRefusalWord(answer.refusal)) return answer.refusal;
  if (answer.status === 429) return 'rate-limited';
  if (answer.status === 403) return 'not-allowed';
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
