import { onboardingHref, usernameHref } from '../access/decision';
import { idle, type Idle, type Moved } from '../forms/form-state';

/** The choices as posted, so a form shown again keeps them. */
export type AgeEntry = {
  readonly month: string;
  readonly year: string;
  readonly terms: boolean;
};

export type AgeField = keyof AgeEntry;

/** The answer left something out; `missing` is never empty. */
export type AgeIncomplete = AgeEntry & {
  readonly kind: 'incomplete';
  readonly missing: readonly AgeField[];
};

/** The answer was complete but could not be recorded; try again. */
export type AgeUnavailable = AgeEntry & { readonly kind: 'unavailable' };

/** What the age form's server action answers. */
export type AgeFormState = Idle | AgeIncomplete | AgeUnavailable | Moved;

export const initialAgeForm: AgeFormState = idle();

const blankEntry: AgeEntry = { month: '', year: '', terms: false };

export const ageIncomplete = (
  entry: AgeEntry,
  missing: readonly AgeField[],
): AgeIncomplete => ({ kind: 'incomplete', ...entry, missing });

export const ageUnavailable = (entry: AgeEntry): AgeUnavailable => ({
  kind: 'unavailable',
  ...entry,
});

/**
 * A posted form whose answer never reached the server, because the
 * browser's call to the action failed in transport.
 */
export const ageFormUnavailable = (): AgeFormState =>
  ageUnavailable(blankEntry);

/** What the age form renders: the entry to show again and what is wrong with it. */
export type AgeFields = AgeEntry & {
  readonly missing: readonly AgeField[];
  readonly unavailable: boolean;
};

export function ageFields(answer: AgeFormState): AgeFields {
  switch (answer.kind) {
    case 'idle':
    case 'moved':
      return { ...blankEntry, missing: [], unavailable: false };
    case 'incomplete':
      return {
        month: answer.month,
        year: answer.year,
        terms: answer.terms,
        missing: answer.missing,
        unavailable: false,
      };
    case 'unavailable':
      return {
        month: answer.month,
        year: answer.year,
        terms: answer.terms,
        missing: [],
        unavailable: true,
      };
  }
}

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
  | { readonly ok: false; readonly state: AgeIncomplete } {
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
    : { ok: false, state: ageIncomplete({ month, year, terms }, missing) };
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
