import { isAppError, createAppError, createRefusal } from '@daisy/errors';
import { serviceRoles } from './schema/service-availability';
import { listedWord } from './lifecycle-sql';
import { idSchema } from '@daisy/protocol/primitives';
import { sql } from 'drizzle-orm';
import type { BoundedTransaction } from './bounded-transaction';
import { causeChainMember, query } from './raw-rows';
import type { Tx } from './tx';
import { z } from 'zod';

/**
 * Refuses unless this web instance's own lease is current. With `lock`, the
 * lease row is held to commit with FOR KEY SHARE: it fences the row's deletion
 * (the retention purge) but not the instance's own renewal, a non-key UPDATE,
 * so slow maintenance can never lapse the lease it runs under (DAISY-WEB-9).
 */
export async function requireCurrentWeb(
  tx: Tx,
  instanceId: string,
  lock = false,
) {
  const rows = await query(
    tx,
    z.object({ instance_id: z.string() }),
    sql`select instance_id from service_instances where instance_id=${instanceId} and role=${listedWord(serviceRoles, 'web')}
    and renewed_at>clock_timestamp()-${SERVICE_LEASE_WINDOW_MS}*interval '1 millisecond' ${lock ? sql`for key share` : sql``}`,
  );
  if (rows.length !== 1)
    throw createRefusal(
      'AUTHORIZATION',
      'service-lease-lapsed',
      'Maintenance service is not current',
    );
}

/** A worker can lose authority while waiting for feature locks. Check both boundaries. */
export function currentWebTransaction(
  run: BoundedTransaction,
  instanceId: string,
): BoundedTransaction {
  if (!idSchema.safeParse(instanceId).success)
    throw createAppError('VALIDATION');
  return (work, options) =>
    run(async (...args) => {
      await requireCurrentWeb(args[0], instanceId);
      const result = await work(...args);
      await requireCurrentWeb(args[0], instanceId);
      return result;
    }, options);
}

/**
 * How long any service lease, web or realtime, stays current after its
 * renewal is stamped (ADR 0033 §7). `requireCurrentWeb` refuses a web
 * instance past it, and the availability sampler counts a peer of either
 * role live only within it. A renewal that took longer than this to settle
 * proves nothing: its stamp may already have lapsed.
 */
export const SERVICE_LEASE_WINDOW_MS = 3000;

/**
 * The refusal `requireCurrentWeb` raises when this web instance's own service
 * lease is not current (DAISY-WEB-9), recognised by its reason, never its
 * message, also through bounded native cause wrappers (as `isCapacityRefusal`
 * is), so a worker that wraps a store error still logs the lapse as a
 * warning.
 */
export const isServiceLeaseLapse = (error: unknown): boolean =>
  causeChainMember(
    (candidate) =>
      isAppError(candidate) && candidate.reason === 'service-lease-lapsed',
    error,
  ) !== undefined;
