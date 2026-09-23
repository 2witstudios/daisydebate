import type { PasskeyAutofillOutcome } from '../sign-in-port';

/**
 * How long one autofill request stays pending before it is replaced. It must
 * stay under `@better-auth/passkey`'s 300 s challenge lifetime, or a person
 * who picks a passkey later is refused for a challenge the server dropped.
 */
export const AUTOFILL_REFRESH_MS = 240_000;
const FIRST_RETRY_MS = 1_000;

/**
 * Delay before re-offering after the `attempt`-th consecutive ending: 1 s,
 * 2 s, 4 s … capped at the refresh interval, so a failing service (every
 * request costs a challenge and a rate-limit slot) is never hammered.
 */
export const autofillRetryDelayMs = (attempt: number): number =>
  Math.min(FIRST_RETRY_MS * 2 ** attempt, AUTOFILL_REFRESH_MS);

/** Injected so the loop is testable and never reads ambient time. */
export type AutofillTimers = {
  readonly set: (run: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
};

const offersAgain = (outcome: PasskeyAutofillOutcome): boolean =>
  outcome.kind === 'interrupted' || outcome.kind === 'refused';

/**
 * Keeps one autofill request pending while the email step is idle: refreshed
 * before its challenge expires, and re-offered with backoff after a dismissal
 * or a refused pick. A newer request aborts the pending one, so every
 * replaced request's ending is stale and dropped, except a sign-in, which
 * the server has already made. Returns the function that stops the loop.
 */
export function startPasskeyAutofill({
  offer,
  onSettled,
  timers,
}: {
  readonly offer: () => Promise<PasskeyAutofillOutcome>;
  readonly onSettled: (outcome: PasskeyAutofillOutcome) => void;
  readonly timers: AutofillTimers;
}): () => void {
  let generation = 0;
  let timer: unknown;
  const arm = (attempt: number): void => {
    generation += 1;
    const current = generation;
    timers.clear(timer);
    timer = timers.set(() => arm(0), AUTOFILL_REFRESH_MS);
    void offer().then((outcome) => {
      if (outcome.kind !== 'signed-in' && current !== generation) return;
      onSettled(outcome);
      if (current !== generation) return;
      timers.clear(timer);
      timer = offersAgain(outcome)
        ? timers.set(() => arm(attempt + 1), autofillRetryDelayMs(attempt))
        : undefined;
    });
  };
  arm(0);
  return () => {
    generation += 1;
    timers.clear(timer);
  };
}
