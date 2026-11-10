/** Queued mail fails for good after this many delivery attempts (ADR 0075, ADR 0124). */
export const MAIL_MAX_ATTEMPTS = 8;

/**
 * When a failed delivery tries again: 30 seconds doubled per attempt, capped
 * at one hour, so eight attempts span about two hours of provider outage.
 */
export function mailRetryDelayMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);
}

/** A queue claim's lease: the longest a worker lease may be. */
export const MAIL_LEASE_MS = 60_000;
/** One claim's worst case: a provider call with its retry (10 s) and its reads. */
const CLAIM_BUDGET_MS = 15_000;
/**
 * How many claims one lease covers when they are sent one after another,
 * with time to settle the last: a slow provider never lets a later claim
 * lapse to another instance before it is settled (ADR 0075, ADR 0124).
 */
export const MAIL_QUEUE_BATCH = Math.floor(
  (MAIL_LEASE_MS - 10_000) / CLAIM_BUDGET_MS,
);

/** A failed attempt backs off, and fails for good at the attempt cap. */
export function retryOrFail<Code extends string>(
  attempts: number,
  now: string,
  errorCode: Code,
):
  | { readonly kind: 'failed'; readonly errorCode: Code }
  | {
      readonly kind: 'retry';
      readonly errorCode: Code;
      readonly nextAttemptAt: string;
    } {
  return attempts >= MAIL_MAX_ATTEMPTS
    ? { kind: 'failed', errorCode }
    : {
        kind: 'retry',
        errorCode,
        nextAttemptAt: new Date(
          Date.parse(now) + mailRetryDelayMs(attempts),
        ).toISOString(),
      };
}
