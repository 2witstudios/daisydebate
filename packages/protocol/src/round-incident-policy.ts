/**
 * A platform incident's bounds (ADR 0110). Every value here is PROVISIONAL. Local kill
 * drills, with nodes staying dead, held under them: seats back at most about 10 s, capture
 * about 16 s. No drill has run on staging or tested the recovery bound, so none is final.
 */
export const roundIncidentPolicy = {
  /** PROVISIONAL. How long the vendor stays unreachable before a Round pauses. */
  vendorUnreachableMs: 5_000,
  /** PROVISIONAL. With the platform back, how long a pause waits for absent seats. */
  seatGraceMs: 30_000,
  /** PROVISIONAL. Past this with the platform still down, the Round ends. */
  recoveryBoundMs: 90_000,
  /** PROVISIONAL. The automatic countdown shown to everyone before the clock runs. */
  resumeCountdownMs: 5_000,
} as const;
