import type { Clock, IdGenerator } from '@daisy/clock';
import { appendAudit } from '../audit/store';
import type { AuditDetail } from '../audit/chain';
import type { AdminDatabase } from '../db/client';
import type { RandomBytes } from './secrets';
import {
  ATTEMPT_LIMIT,
  attemptBucket,
  attemptsExhausted,
  attemptWindow,
  clientDigest,
  type AttemptPurpose,
} from './rate-limit';
import { failuresIn, releaseSlot, reserveSlot } from './store';
import type { CeremonyOrigin } from './webauthn';

/** Everything a ceremony needs, injected at the process edge. */
export type AuthDeps = {
  readonly db: AdminDatabase;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly random: RandomBytes;
  readonly attemptKey: string;
  readonly ceremony: CeremonyOrigin;
};

/** One uniform refusal: a caller never learns which check failed. */
export type Refusal = {
  readonly ok: false;
  readonly code: 'AUTHENTICATION' | 'RATE_LIMIT';
};

export type Attempt = {
  readonly purpose: AttemptPurpose;
  /** The peer address as the admin server saw it; stored only keyed. */
  readonly address: string;
};

const bucketOf = (deps: AuthDeps, attempt: Attempt, now: string) =>
  attemptBucket({
    purpose: attempt.purpose,
    client: clientDigest(deps.attemptKey, attempt.address),
    now,
  });

const audited = (
  deps: AuthDeps,
  now: string,
  detail: AuditDetail,
  operatorId: string | null,
) =>
  deps.db.transaction((tx) =>
    appendAudit(tx, {
      id: deps.ids.next(),
      kind: 'auth.failure',
      operatorId,
      commandId: null,
      targetUserId: null,
      outcome: null,
      detail,
      at: now,
    }),
  );

/** A slot in the client's window, held by an attempt that can still fail. */
export type Reservation = { readonly bucket: string; readonly count: number };

/**
 * Takes a slot before a ceremony that can fail. The count comes back from
 * one atomic increment, so racing attempts never get more than the limit
 * between them; a refused attempt keeps its slot, a success gives it back.
 */
export async function reserveAttempt(
  deps: AuthDeps,
  attempt: Attempt,
): Promise<Refusal | Reservation> {
  const now = deps.clock.now();
  const bucket = bucketOf(deps, attempt, now);
  const count = await reserveSlot(deps.db, {
    bucket,
    windowStart: attemptWindow(now),
  });
  return count > ATTEMPT_LIMIT
    ? { ok: false, code: 'RATE_LIMIT' }
    : { bucket, count };
}

export const releaseAttempt = (deps: AuthDeps, reservation: Reservation) =>
  releaseSlot(deps.db, reservation.bucket);

/**
 * The reserved slot was a failure: audit it and refuse uniformly. The
 * failure holding the window's last slot also records the limit, once;
 * blocked requests after it write nothing.
 */
export async function refuse(
  deps: AuthDeps,
  reservation: Reservation,
  detail: AuditDetail,
  operatorId: string | null = null,
): Promise<Refusal> {
  const now = deps.clock.now();
  await audited(deps, now, detail, operatorId);
  if (reservation.count === ATTEMPT_LIMIT)
    await audited(deps, now, 'rate_limited', null);
  return { ok: false, code: 'AUTHENTICATION' };
}

/** A read-only check for a step that cannot fail (issuing a challenge). */
export async function rateLimited(
  deps: AuthDeps,
  attempt: Attempt,
): Promise<Refusal | null> {
  const now = deps.clock.now();
  const failures = await failuresIn(deps.db, bucketOf(deps, attempt, now));
  return attemptsExhausted(failures) ? { ok: false, code: 'RATE_LIMIT' } : null;
}

/** PostgreSQL unique_violation, whether drizzle wrapped the driver error or not. */
export const isUniqueViolation = (error: unknown): boolean => {
  for (let current = error; current instanceof Error; current = current.cause)
    if ((current as { errno?: unknown }).errno === '23505') return true;
  return false;
};
