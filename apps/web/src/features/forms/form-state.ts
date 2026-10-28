/**
 * The shared shape of a posted form's answer: the typed values, an error to
 * show, and, once the post is accepted, where to go next. Room, ballot,
 * Round-command and settings forms all answer with it.
 */
export type FormState = {
  /** What was typed, so a refusal renders it again. */
  readonly values: Readonly<Record<string, string>>;
  readonly error?: string;
  readonly next?: string;
};

export const initialFormState: FormState = { values: {} };

/** How one posted form was read: a value, or the message that refuses it. */
export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export const refuse = (error: string): Parsed<never> => ({ ok: false, error });
export const accept = <T>(value: T): Parsed<T> => ({ ok: true, value });

/** The text fields of a posted form. A file or a missing field is skipped. */
export function formValues(form: FormData): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const [key, value] of form.entries())
    if (typeof value === 'string') values[key] = value;
  return values;
}

/** One text field, trimmed: absent or not text reads as empty. */
export const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

/** The state a failed post answers with. */
export const refused = (form: FormData, error: string): FormState => ({
  values: formValues(form),
  error,
});

/** The state an unreachable server answers with, typed values kept. */
export const formUnavailable = (form: FormData): FormState => ({
  values: formValues(form),
  error: 'Something went wrong. Try again.',
});
