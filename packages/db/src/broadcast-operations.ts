import type { BroadcastReleasePolicy } from '@daisy/protocol';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';
import { broadcasts } from './schema/broadcasts';

type Tx = BoundedTransactionContext;

/** One Broadcast per Round: a repeat keeps the first, policy included. */
export const openBroadcast = async (
  tx: Tx,
  input: {
    readonly id: string;
    readonly roundId: string;
    readonly releasePolicy: BroadcastReleasePolicy;
    readonly debatersReadChat?: boolean;
  },
) => {
  await tx
    .insert(broadcasts)
    .values(input)
    .onConflictDoNothing({ target: broadcasts.roundId });
  const [row] = await tx
    .select()
    .from(broadcasts)
    .where(eq(broadcasts.roundId, input.roundId));
  return row!;
};

/** Takes the oldest open Broadcast whose lease is free; the epoch fences the last owner. */
export const claimBroadcast = async (
  tx: Tx,
  input: {
    readonly owner: string;
    readonly now: Date;
    readonly leaseUntil: Date;
  },
) => {
  const [free] = await tx
    .select({ id: broadcasts.id })
    .from(broadcasts)
    .where(
      and(
        isNull(broadcasts.completedAt),
        or(
          isNull(broadcasts.leaseUntil),
          lte(broadcasts.leaseUntil, input.now),
        ),
      ),
    )
    .orderBy(asc(broadcasts.createdAt))
    .limit(1)
    .for('update', { skipLocked: true });
  if (!free) return null;
  const [claimed] = await tx
    .update(broadcasts)
    .set({
      leaseOwner: input.owner,
      leaseUntil: input.leaseUntil,
      leaseEpoch: sql`${broadcasts.leaseEpoch} + 1`,
    })
    .where(eq(broadcasts.id, free.id))
    .returning();
  return claimed!;
};

const held = (id: string, owner: string, epoch: number) =>
  and(
    eq(broadcasts.id, id),
    eq(broadcasts.leaseOwner, owner),
    eq(broadcasts.leaseEpoch, epoch),
  );

/**
 * Moves the cursor and the watermark together, only from the expected segment
 * and only for the current lease, so a fenced worker cannot move either. The
 * watermark never recedes. False means this worker no longer owns the job.
 */
export const recordSegmentReleased = async (
  tx: Tx,
  input: {
    readonly id: string;
    readonly owner: string;
    readonly epoch: number;
    readonly segment: number;
    readonly mediaEnd: Date;
  },
): Promise<boolean> => {
  const rows = await tx
    .update(broadcasts)
    .set({
      nextSegment: input.segment + 1,
      releasedThroughAt: sql`greatest(${broadcasts.releasedThroughAt}, ${input.mediaEnd.toISOString()}::timestamptz)`,
    })
    .where(
      and(
        held(input.id, input.owner, input.epoch),
        eq(broadcasts.nextSegment, input.segment),
      ),
    )
    .returning({ id: broadcasts.id });
  return rows.length === 1;
};

/** The watermark the spectator timeline reads; null until media is out. */
export const readReleasedThrough = async (tx: Tx, roundId: string) => {
  const [row] = await tx
    .select({ at: broadcasts.releasedThroughAt })
    .from(broadcasts)
    .where(eq(broadcasts.roundId, roundId));
  return row?.at ?? null;
};
