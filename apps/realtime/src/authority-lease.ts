type Attempt = {
  readonly generation: number;
  readonly session: string;
  readonly revision: string;
  readonly expiresAt: number;
};

/** Transport fencing only: the injected canonical evaluator decides authority.
 * Lifetime is supplied by composition; this seam declares no accepted policy.
 * Every replay/attachment/publish checks elapsed monotonic time, independently
 * of timer scheduling and whether an upstream request obeyed cancellation.
 */
export function createAuthorityLease({
  now,
  lifetimeMs,
}: {
  readonly now: () => number;
  readonly lifetimeMs: number;
}) {
  if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs <= 0)
    throw new Error('Invalid authority lifetime');
  let generation = 0;
  let active: Attempt | undefined;
  let accepted = false;
  let effectiveExpiry = 0;
  function invalidate() {
    generation += 1;
    active = undefined;
    accepted = false;
  }
  return {
    begin(session: string, revision: string): Attempt {
      invalidate();
      active = { generation, session, revision, expiresAt: now() + lifetimeMs };
      effectiveExpiry = active.expiresAt;
      return active;
    },
    invalidate,
    expired: () => now() >= effectiveExpiry,
    owns(attempt: Attempt): boolean {
      return active === attempt && attempt.generation === generation;
    },
    accept(attempt: Attempt, validUntil = attempt.expiresAt): boolean {
      if (
        !Number.isFinite(validUntil) ||
        active !== attempt ||
        attempt.generation !== generation ||
        now() >= Math.min(attempt.expiresAt, validUntil)
      )
        return false;
      accepted = true;
      effectiveExpiry = Math.min(attempt.expiresAt, validUntil);
      return true;
    },
    current(): boolean {
      if (!active || now() >= effectiveExpiry) {
        invalidate();
        return false;
      }
      return accepted;
    },
  };
}
