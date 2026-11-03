/**
 * Judging's own bounds. None borrows the meaning of an attendance bound, and
 * attendance holds none of these (ADR 0095).
 */
export const judgingPolicy = {
  /** How long after the freeze a human judge may rule (DEC-201). */
  humanBallotWindowMs: 30 * 60_000,
  /** How long after the freeze an AI judging job may buy provider work (DEC-275). */
  aiBudgetMs: 5 * 60_000,
  /**
   * How long a validated ballot a worker still holds keeps its Round waiting
   * after attendance last settled, so a worker has its chance to submit it.
   */
  heldBallotGraceMs: 10 * 60_000,
  /** Paid model calls one job may buy over all its leases (ISSUE-461). */
  maxPaidCalls: 2,
  /** Wait before another attempt after a failure that may be transient. */
  retryMs: 5_000,
} as const;
