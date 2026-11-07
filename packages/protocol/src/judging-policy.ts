/**
 * Judging's own bounds. None borrows the meaning of an attendance bound, and
 * attendance holds none of these (ADR 0095).
 */
export const judgingPolicy = {
  /** How long after the freeze a human judge may rule (DEC-201). */
  humanBallotWindowMs: 30 * 60_000,
  /** How long after the freeze an AI judging job may buy provider work (DEC-275). */
  aiBudgetMs: 5 * 60_000,
  /** Paid calls in one bounded generation window; recovery opens a later window. */
  maxPaidCalls: 2,
  /** Finite automatic lifetime spending; exhaustion preserves blocked recovery. */
  maxAutomaticPaidCalls: 16,
  /** A spent generation window releases capacity before a later recovery window. */
  recoveryMs: 30_000,
  /** Cached submissions have bounded local capacity independent of paid calls. */
  submissionParallel: 1,
  /** Wait before another attempt after a failure that may be transient. */
  retryMs: 5_000,
} as const;
export const judgingWorkKinds = ['submission', 'generation'] as const;
export type JudgingWorkKind = (typeof judgingWorkKinds)[number];
