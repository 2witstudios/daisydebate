import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { AdminExecutor, AdminTransaction } from '../db/client';
import {
  authAttempts,
  operatorChallenges,
  operatorCredentials,
  operatorEnrollments,
  operators,
  operatorSessions,
} from '../db/schema';

/**
 * The admin authentication rows (ADR 0076). Every single-use secret is
 * consumed by one conditional UPDATE … RETURNING, so of two racing callers
 * exactly one sees the row; times are injected, never `now()`.
 */
type ChallengePurpose = 'register' | 'authenticate';
const date = (iso: string) => new Date(iso);

export async function findOperator(db: AdminExecutor, id: string) {
  const [row] = await db.select().from(operators).where(eq(operators.id, id));
  return row ?? null;
}

export async function findActiveOperatorByName(
  db: AdminExecutor,
  displayName: string,
) {
  const [row] = await db
    .select()
    .from(operators)
    .where(
      and(eq(operators.displayName, displayName), isNull(operators.disabledAt)),
    )
    .limit(1);
  return row ?? null;
}

export async function revokeOpenEnrollments(
  tx: AdminTransaction,
  operatorId: string,
  now: string,
): Promise<void> {
  await tx
    .update(operatorEnrollments)
    .set({ revokedAt: date(now) })
    .where(
      and(
        eq(operatorEnrollments.operatorId, operatorId),
        isNull(operatorEnrollments.consumedAt),
        isNull(operatorEnrollments.revokedAt),
      ),
    );
}

/** An enrollment still open at `now`, with its operator. */
export async function findOpenEnrollment(
  db: AdminExecutor,
  tokenHash: string,
  now: string,
) {
  const [row] = await db
    .select({ enrollment: operatorEnrollments, operator: operators })
    .from(operatorEnrollments)
    .innerJoin(operators, eq(operators.id, operatorEnrollments.operatorId))
    .where(
      and(
        eq(operatorEnrollments.tokenHash, tokenHash),
        isNull(operatorEnrollments.consumedAt),
        isNull(operatorEnrollments.revokedAt),
        gt(operatorEnrollments.expiresAt, date(now)),
        isNull(operators.disabledAt),
      ),
    );
  return row ?? null;
}

export async function consumeEnrollment(
  tx: AdminTransaction,
  id: string,
  now: string,
): Promise<boolean> {
  const rows = await tx
    .update(operatorEnrollments)
    .set({ consumedAt: date(now) })
    .where(
      and(
        eq(operatorEnrollments.id, id),
        isNull(operatorEnrollments.consumedAt),
        isNull(operatorEnrollments.revokedAt),
        gt(operatorEnrollments.expiresAt, date(now)),
      ),
    )
    .returning({ id: operatorEnrollments.id });
  return rows.length === 1;
}

export async function insertChallenge(
  db: AdminExecutor,
  row: {
    readonly id: string;
    readonly purpose: ChallengePurpose;
    readonly enrollmentId: string | null;
    readonly challengeHash: string;
    readonly now: string;
    readonly expiresAt: string;
  },
): Promise<void> {
  await db.insert(operatorChallenges).values({
    id: row.id,
    purpose: row.purpose,
    enrollmentId: row.enrollmentId,
    challengeHash: row.challengeHash,
    createdAt: date(row.now),
    expiresAt: date(row.expiresAt),
  });
}

const openChallenge = (
  challengeHash: string,
  purpose: ChallengePurpose,
  now: string,
) =>
  and(
    eq(operatorChallenges.challengeHash, challengeHash),
    eq(operatorChallenges.purpose, purpose),
    isNull(operatorChallenges.consumedAt),
    gt(operatorChallenges.expiresAt, date(now)),
  );

/** Reads, never consumes: GET and the pre-verification lookup use this. */
export async function peekChallenge(
  db: AdminExecutor,
  challengeHash: string,
  purpose: ChallengePurpose,
  now: string,
) {
  const [row] = await db
    .select({ enrollmentId: operatorChallenges.enrollmentId })
    .from(operatorChallenges)
    .where(openChallenge(challengeHash, purpose, now));
  return row ?? null;
}

/** Single use, bound to its purpose and (for register) its enrollment. */
export async function consumeChallenge(
  tx: AdminExecutor,
  input: {
    readonly challengeHash: string;
    readonly purpose: ChallengePurpose;
    readonly enrollmentId: string | null;
    readonly now: string;
  },
): Promise<boolean> {
  const binding =
    input.enrollmentId === null
      ? isNull(operatorChallenges.enrollmentId)
      : eq(operatorChallenges.enrollmentId, input.enrollmentId);
  const rows = await tx
    .update(operatorChallenges)
    .set({ consumedAt: date(input.now) })
    .where(
      and(
        openChallenge(input.challengeHash, input.purpose, input.now),
        binding,
      ),
    )
    .returning({ id: operatorChallenges.id });
  return rows.length === 1;
}

export async function activeCredentials(db: AdminExecutor, operatorId: string) {
  return db
    .select()
    .from(operatorCredentials)
    .where(
      and(
        eq(operatorCredentials.operatorId, operatorId),
        isNull(operatorCredentials.revokedAt),
      ),
    );
}

export async function findActiveCredential(
  db: AdminExecutor,
  credentialId: string,
) {
  const [row] = await db
    .select({ credential: operatorCredentials, operator: operators })
    .from(operatorCredentials)
    .innerJoin(operators, eq(operators.id, operatorCredentials.operatorId))
    .where(
      and(
        eq(operatorCredentials.credentialId, credentialId),
        isNull(operatorCredentials.revokedAt),
      ),
    );
  return row ?? null;
}

/** Revokes every live credential of the operator but `keep`; returns how many. */
export async function revokeCredentials(
  tx: AdminTransaction,
  input: {
    readonly operatorId: string;
    readonly keep: string;
    readonly now: string;
  },
): Promise<number> {
  const rows = await tx
    .update(operatorCredentials)
    .set({ revokedAt: date(input.now) })
    .where(
      and(
        eq(operatorCredentials.operatorId, input.operatorId),
        ne(operatorCredentials.id, input.keep),
        isNull(operatorCredentials.revokedAt),
      ),
    )
    .returning({ id: operatorCredentials.id });
  return rows.length;
}

export async function revokeSessions(
  tx: AdminExecutor,
  input: {
    readonly operatorId: string;
    readonly now: string;
    readonly only?: string;
  },
): Promise<number> {
  const rows = await tx
    .update(operatorSessions)
    .set({ revokedAt: date(input.now) })
    .where(
      and(
        eq(operatorSessions.operatorId, input.operatorId),
        input.only === undefined
          ? undefined
          : eq(operatorSessions.id, input.only),
        isNull(operatorSessions.revokedAt),
      ),
    )
    .returning({ id: operatorSessions.id });
  return rows.length;
}

export async function findSession(db: AdminExecutor, tokenHash: string) {
  const [row] = await db
    .select()
    .from(operatorSessions)
    .where(eq(operatorSessions.tokenHash, tokenHash));
  return row ?? null;
}

export async function touchSession(
  db: AdminExecutor,
  id: string,
  now: string,
): Promise<void> {
  await db
    .update(operatorSessions)
    .set({ lastSeenAt: date(now) })
    .where(eq(operatorSessions.id, id));
}

export async function failuresIn(
  db: AdminExecutor,
  bucket: string,
): Promise<number> {
  const [row] = await db
    .select({ count: authAttempts.count })
    .from(authAttempts)
    .where(eq(authAttempts.bucket, bucket));
  return row?.count ?? 0;
}

/** The window's count after this failure, incremented atomically. */
export async function recordFailure(
  db: AdminExecutor,
  input: { readonly bucket: string; readonly windowStart: string },
): Promise<number> {
  const [row] = await db
    .insert(authAttempts)
    .values({
      bucket: input.bucket,
      count: 1,
      windowStart: date(input.windowStart),
    })
    .onConflictDoUpdate({
      target: authAttempts.bucket,
      set: { count: sql`${authAttempts.count} + 1` },
    })
    .returning({ count: authAttempts.count });
  return row?.count ?? 0;
}
