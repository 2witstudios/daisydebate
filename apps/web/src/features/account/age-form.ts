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
