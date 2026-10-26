import type { Clock, IdGenerator } from '@daisy/clock';
import { appendAudit } from '../audit/store';
import type { AuditDetail } from '../audit/chain';
import type { AdminDatabase } from '../db/client';
import type { RandomBytes } from './secrets';
import {
  attemptBucket,
  attemptsExhausted,
  attemptWindow,
  clientDigest,
  type AttemptPurpose,
} from './rate-limit';
import { failuresIn, recordFailure } from './store';
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

/** Counts and audits one failed attempt, then refuses uniformly. */
export async function refuse(
  deps: AuthDeps,
  attempt: Attempt,
  detail: AuditDetail,
  operatorId: string | null = null,
): Promise<Refusal> {
  const now = deps.clock.now();
  await recordFailure(deps.db, {
    bucket: bucketOf(deps, attempt, now),
    windowStart: attemptWindow(now),
  });
  await audited(deps, now, detail, operatorId);
  return { ok: false, code: 'AUTHENTICATION' };
}

/** Refuses before any ceremony once the client's window is exhausted. */
export async function rateLimited(
  deps: AuthDeps,
  attempt: Attempt,
): Promise<Refusal | null> {
  const now = deps.clock.now();
  if (
    !attemptsExhausted(await failuresIn(deps.db, bucketOf(deps, attempt, now)))
  )
    return null;
  await audited(deps, now, 'rate_limited', null);
  return { ok: false, code: 'RATE_LIMIT' };
}

/** PostgreSQL unique_violation, whether drizzle wrapped the driver error or not. */
export const isUniqueViolation = (error: unknown): boolean => {
  for (let current = error; current instanceof Error; current = current.cause)
    if ((current as { errno?: unknown }).errno === '23505') return true;
  return false;
};
