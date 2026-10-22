import { and, eq, gt, isNull, lte } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransactionContext } from './transaction-context';
import { aiAllowanceGrants } from './schema/ai-allowance-grants';

/** DEC183: UTC calendar month or an actual current grant, never a caller entitlement. */
export async function readBotAllowance(
  tx: BoundedTransactionContext,
  actorId: string,
  now: Date,
) {
  const grants = await tx
    .select()
    .from(aiAllowanceGrants)
    .where(
      and(
        eq(aiAllowanceGrants.actorId, actorId),
        isNull(aiAllowanceGrants.revokedAt),
        lte(aiAllowanceGrants.periodStart, now),
        gt(aiAllowanceGrants.periodEnd, now),
      ),
    )
    .for('share');
  if (grants.length > 1)
    throw createAppError('INFRASTRUCTURE', 'Ambiguous allowance grant');
  const grant = grants[0];
  if (grant)
    return {
      start: grant.periodStart,
      end: grant.periodEnd,
      limit: 10 as const,
    };
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    limit: 1 as const,
  };
}
