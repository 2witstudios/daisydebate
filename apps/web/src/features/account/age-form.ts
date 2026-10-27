import { onboardingHref, usernameHref } from '../access/decision';

/** What the age form's server action answers. */
export type AgeFormState = {
  /** The choices as posted, so a refused form shows them again. */
  readonly month: string;
  readonly year: string;
  readonly terms: boolean;
  /** Fields the answer is missing; empty when it was complete. */
  readonly missing: readonly ('month' | 'year' | 'terms')[];
  /** The answer could not be recorded; try again. */
  readonly unavailable?: boolean;
  /** Where a hydrated page navigates once the answer landed. */
  readonly next?: string;
};

export const initialAgeForm: AgeFormState = {
  month: '',
  year: '',
  terms: false,
  missing: [],
};

/** The months, in order, as the select offers them; values are 1 to 12. */
export const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** The year select's choices: this year back 100 years, newest first. */
export const birthYears = (now: string): readonly number[] => {
  const year = new Date(now).getUTCFullYear();
  return Array.from({ length: 101 }, (_, index) => year - index);
};

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/**
 * The posted form read as the age route's body, or the state that names
 * what is missing. The route checks everything again; this only spares a
 * round trip for an empty choice.
 */
export function readAgeForm(form: FormData):
  | {
      readonly ok: true;
      readonly body: { month: number; year: number; terms: true };
    }
  | { readonly ok: false; readonly state: AgeFormState } {
  const month = field(form, 'month');
  const year = field(form, 'year');
  const terms = field(form, 'terms') === 'accepted';
  const missing = [
    ...(/^(?:[1-9]|1[0-2])$/.test(month) ? [] : ['month' as const]),
    ...(/^[0-9]{4}$/.test(year) ? [] : ['year' as const]),
    ...(terms ? [] : ['terms' as const]),
  ];
  return missing.length === 0
    ? {
        ok: true,
        body: { month: Number(month), year: Number(year), terms: true },
      }
    : { ok: false, state: { month, year, terms, missing } };
}

/** What POST /api/account/age answered, as the form action needs it. */
export type AgeAnswer =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'refused'; readonly refusal: 'under-13' | 'below-floor' }
  | { readonly kind: 'unavailable' };

/**
 * Reads the age route's answer. A 409 means this account answered already
 * and that first answer stands, so it moves on like an accepted answer
 * (DEC-246); a 403 carries the refusal that holds the browser; anything else
 * is unavailable and the form is shown again.
 */
export async function readAgeAnswer(response: Response): Promise<AgeAnswer> {
  if (response.ok || response.status === 409) return { kind: 'accepted' };
  if (response.status !== 403) return { kind: 'unavailable' };
  const body: unknown = await response.json().catch(() => null);
  const refusal = (body as { error?: { refusal?: unknown } } | null)?.error
    ?.refusal;
  return refusal === 'under-13' || refusal === 'below-floor'
    ? { kind: 'refused', refusal }
    : { kind: 'unavailable' };
}

/**
 * Where the form goes after an answer: an accepted answer (or one given
 * already) on to the username step, a refusal back to the age step, which
 * then shows it; the validated destination rides along either way. Null
 * when the form stays put.
 */
export const ageAnswerHref = (
  answer: AgeAnswer,
  destination: string,
): string | null =>
  answer.kind === 'accepted'
    ? usernameHref(destination)
    : answer.kind === 'refused'
      ? onboardingHref(destination)
      : null;
