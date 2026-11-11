/**
 * A posted form's answer is exactly one of a union discriminated on `kind`.
 * Every form's `*FormState` follows this convention:
 *
 * - The discriminant is `kind`. A field exists only on the variant where it
 *   means something; nothing is optional, so no two outcomes can be held at
 *   once and no reader decides between them by the order of its checks.
 * - The shared vocabulary lives here. `idle`: nothing posted yet (`values`
 *   may seed the fields). `refused`: `values` to render again beside `error`.
 *   `done`: accepted, and the page stays where it is. `moved`: accepted, and
 *   the page goes to `next`. `unacknowledged`: the answer was lost, so the
 *   post may have been recorded; `values` are the original fields, which the
 *   retry posts unchanged.
 * - A form composes its state from these and adds its own accepted variants
 *   beside them (the ballot's `recorded` with its receipt, a Room's
 *   `accepted` with its view). It reuses a shared `kind` only with the shared
 *   shape.
 * - Producers build answers with the constructors here and in the form's
 *   own module, never with object literals. `moveOn` already answers
 *   `moved`; `stayOn` answers it or null.
 * - Readers switch on `kind` exhaustively (a `switch` with no default, or
 *   `unreachable` in it), so a new variant fails to compile until every
 *   reader handles it. A component that only renders the fields takes
 *   `FormFields`, which the form's module projects from its state in one
 *   total switch.
 */
export type FormValues = Readonly<Record<string, string>>;

export type Idle = { readonly kind: 'idle'; readonly values: FormValues };
export type Refused = {
  readonly kind: 'refused';
  readonly values: FormValues;
  readonly error: string;
};
export type Done = { readonly kind: 'done' };
export type Moved = { readonly kind: 'moved'; readonly next: string };
export type Unacknowledged = {
  readonly kind: 'unacknowledged';
  readonly values: FormValues;
};

/** The answer of a form with nothing of its own to hand back. */
export type FormState = Idle | Refused | Done | Moved;

/** What a form's fields render from: the values to show again and the refusal beside them. */
export type FormFields = {
  readonly values: FormValues;
  readonly error: string | undefined;
};

const noValues: FormValues = {};

export const idle = (values: FormValues = noValues): Idle => ({
  kind: 'idle',
  values,
});
export const initialFormState: FormState = idle();

export const refusedWith = (values: FormValues, error: string): Refused => ({
  kind: 'refused',
  values,
  error,
});
export const done: Done = { kind: 'done' };
export const moved = (next: string): Moved => ({ kind: 'moved', next });
export const unacknowledged = (form: FormData): Unacknowledged => ({
  kind: 'unacknowledged',
  values: formValues(form),
});

/** Where an answer sends the page, when it sends it anywhere. */
export const destinationOf = (answer: {
  readonly kind: string;
  readonly next?: string;
}): string | undefined => (answer.kind === 'moved' ? answer.next : undefined);

/** Fails to compile where a `switch` on `kind` misses a variant. */
export function unreachable(kind: never): never {
  throw new Error(`Unhandled form answer: ${String(kind)}`);
}

/** Nothing to render again: the answer was accepted. */
export const blankFields: FormFields = { values: noValues, error: undefined };

/** The fields each shared variant renders; a form's own projection ends in it. */
export function formFields(answer: FormState | Unacknowledged): FormFields {
  switch (answer.kind) {
    case 'idle':
    case 'unacknowledged':
      return { values: answer.values, error: undefined };
    case 'refused':
      return { values: answer.values, error: answer.error };
    case 'done':
    case 'moved':
      return blankFields;
  }
}

/** How one posted form was read: a value, or the message that refuses it. */
export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export const refuse = (error: string): Parsed<never> => ({ ok: false, error });
export const accept = <T>(value: T): Parsed<T> => ({ ok: true, value });

/** The text fields of a posted form. A file or a missing field is skipped. */
export function formValues(form: FormData): FormValues {
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
export const refused = (form: FormData, error: string): Refused =>
  refusedWith(formValues(form), error);

/** The state an unreachable server answers with, typed values kept. */
export const formUnavailable = (form: FormData): Refused =>
  refused(form, 'Something went wrong. Try again.');
