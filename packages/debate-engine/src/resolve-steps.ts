/** The compiler's step vocabulary: a resolved value or a named refusal. */
export type ResolveRefusalKind =
  | 'invalid-definition'
  | 'capability-forbidden'
  | 'out-of-range'
  | 'unknown-segment-key'
  | 'invalid-choice'
  | 'incomplete-timing';

export type ResolveRefusal = {
  readonly kind: ResolveRefusalKind;
  /** What was refused and why, for the operator and the logs. */
  readonly message: string;
};

export type Step<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: ResolveRefusal };

export const refusalOf = (
  kind: ResolveRefusalKind,
  message: string,
): ResolveRefusal => ({ kind, message });
export const stepRefused = (
  kind: ResolveRefusalKind,
  message: string,
): { readonly ok: false; readonly refusal: ResolveRefusal } => ({
  ok: false,
  refusal: refusalOf(kind, message),
});

export const within = (value: number, range: { min: number; max: number }) =>
  value >= range.min && value <= range.max;
