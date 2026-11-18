import { isAppError } from '@daisy/errors';

/** A refusal as the corpus records it: the code and invariant, never the message text. */
export type Recorded<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly refusal: {
        readonly code: string;
        readonly invariantId: string | null;
      };
    };

/** Runs `fn`, recording an AppError's code instead of throwing it. */
export const attempt = <T>(fn: () => T): Recorded<T> => {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    if (!isAppError(error)) throw error;
    return {
      ok: false,
      refusal: { code: error.code, invariantId: error.invariantId ?? null },
    };
  }
};
