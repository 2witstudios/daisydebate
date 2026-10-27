/** A mail intent fails for good after this many delivery attempts (ADR 0075). */
export const MAIL_INTENT_MAX_ATTEMPTS = 8;

/**
 * When a failed delivery tries again: 30 seconds doubled per attempt, capped
 * at one hour, so eight attempts span about two hours of provider outage.
 */
export function mailRetryDelayMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);
}
