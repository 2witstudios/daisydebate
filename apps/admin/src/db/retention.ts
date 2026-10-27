import { lt } from 'drizzle-orm';
import type { AdminDatabase } from './client';
import {
  authAttempts,
  operatorChallenges,
  operatorEnrollments,
  operatorSessions,
} from './schema';

/**
 * The admin retention rules this app enforces itself (privacy.ts, plan §8):
 * expired challenges, enrollments and sessions go 7 days after expiry, and
 * rate-limit buckets a day after their window opened. Credentials, operators
 * and the audit chain are never swept here.
 */
const day = 86_400_000;
export const SWEEP_INTERVAL_MS = 60 * 60_000;

export async function sweepExpired(
  db: AdminDatabase,
  now: string,
): Promise<number> {
  const at = Date.parse(now);
  const secretsBefore = new Date(at - 7 * day);
  const attemptsBefore = new Date(at - day);
  return db.transaction(async (tx) => {
    // Challenges first: they reference their enrollment.
    const removed = [
      await tx
        .delete(operatorChallenges)
        .where(lt(operatorChallenges.expiresAt, secretsBefore))
        .returning({ id: operatorChallenges.id }),
      await tx
        .delete(operatorEnrollments)
        .where(lt(operatorEnrollments.expiresAt, secretsBefore))
        .returning({ id: operatorEnrollments.id }),
      await tx
        .delete(operatorSessions)
        .where(lt(operatorSessions.expiresAt, secretsBefore))
        .returning({ id: operatorSessions.id }),
      await tx
        .delete(authAttempts)
        .where(lt(authAttempts.windowStart, attemptsBefore))
        .returning({ id: authAttempts.bucket }),
    ];
    return removed.reduce((total, rows) => total + rows.length, 0);
  });
}
