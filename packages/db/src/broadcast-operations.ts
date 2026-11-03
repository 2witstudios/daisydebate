import type { BroadcastReleasePolicy } from '@daisy/protocol';
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';
import { broadcasts } from './schema/broadcasts';
import { mediaSessions } from './schema/media-sessions';
import { recordingCaptures } from './schema/recording-captures';
import { rounds } from './schema/rounds';
import {
  roundAliasR,
  spectatorHorizonSql,
  type SpectatorClock,
} from './spectator-release-sql';

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

/**
 * Takes the oldest Broadcast with work left whose lease is free: an open one, or
 * a finished one whose public objects are still up once `withdrawFinishedBefore`
 * has passed its completion. The epoch fences the last owner.
 */
export const claimBroadcast = async (
  tx: Tx,
  input: {
    readonly owner: string;
    readonly now: Date;
    readonly leaseUntil: Date;
    readonly withdrawFinishedBefore: Date;
  },
) => {
  const [free] = await tx
    .select({ id: broadcasts.id })
    .from(broadcasts)
    .where(
      and(
        or(
          isNull(broadcasts.completedAt),
          and(
            isNull(broadcasts.feedWithdrawnAt),
            lte(broadcasts.completedAt, input.withdrawFinishedBefore),
          ),
        ),
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
      holdCursor: sql`${broadcasts.holdCursor} + 1`,
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

/** Keeps the job and returns its current row; null means this worker was fenced. */
export const renewBroadcastLease = async (
  tx: Tx,
  input: {
    readonly id: string;
    readonly owner: string;
    readonly epoch: number;
    readonly leaseUntil: Date;
  },
) => {
  const [row] = await tx
    .update(broadcasts)
    .set({ leaseUntil: input.leaseUntil })
    .where(held(input.id, input.owner, input.epoch))
    .returning();
  return row ?? null;
};

/** The watermark the spectator timeline reads; null until media is out. */
export const readReleasedThrough = async (tx: Tx, roundId: string) => {
  const [row] = await tx
    .select({ at: broadcasts.releasedThroughAt })
    .from(broadcasts)
    .where(eq(broadcasts.roundId, roundId));
  return row?.at ?? null;
};

/** Records the running Egress; the reconcile pass reads its state from LiveKit. */
/** The worker has emptied one attempt's hold and moves to the next. */
export const recordHoldAdvanced = async (
  tx: Tx,
  input: {
    readonly id: string;
    readonly owner: string;
    readonly epoch: number;
  },
): Promise<boolean> => {
  const rows = await tx
    .update(broadcasts)
    .set({
      releasedGeneration: sql`${broadcasts.releasedGeneration} + 1`,
      holdCursor: 0,
    })
    .where(held(input.id, input.owner, input.epoch))
    .returning({ id: broadcasts.id });
  return rows.length > 0;
};

/** Every held segment is out: the timeline reaches the end of the media. */
export const recordMediaEndReleased = async (
  tx: Tx,
  input: {
    readonly id: string;
    readonly owner: string;
    readonly epoch: number;
    readonly mediaEnd: Date;
    readonly now: Date;
  },
): Promise<boolean> => {
  const rows = await tx
    .update(broadcasts)
    .set({
      streamEndedAt: input.now,
      releasedThroughAt: sql`greatest(${broadcasts.releasedThroughAt}, ${input.mediaEnd.toISOString()}::timestamptz)`,
    })
    .where(held(input.id, input.owner, input.epoch))
    .returning({ id: broadcasts.id });
  return rows.length > 0;
};

export const recordEgressStarted = (
  tx: Tx,
  input: {
    readonly id: string;
    readonly egressId: string;
    readonly generation: number;
    readonly stageCredentialHash: string;
    readonly now: Date;
  },
) =>
  tx
    .update(broadcasts)
    .set({
      egressId: input.egressId,
      egressGeneration: input.generation,
      revocationFailures: 0,
      stageCredentialHash: input.stageCredentialHash,
      egressStartedAt: input.now,
    })
    .where(eq(broadcasts.id, input.id));

export const recordObserverRevoked = (
  tx: Tx,
  input: { readonly id: string; readonly now: Date },
) =>
  tx
    .update(broadcasts)
    .set({ observerRevokedAt: input.now, revocationFailures: 0 })
    .where(eq(broadcasts.id, input.id));

export const recordRevocationFailed = (tx: Tx, id: string) =>
  tx
    .update(broadcasts)
    .set({ revocationFailures: sql`${broadcasts.revocationFailures} + 1` })
    .where(eq(broadcasts.id, id));

export const recordObserverRestored = (tx: Tx, id: string) =>
  tx
    .update(broadcasts)
    .set({ observerRevokedAt: null, revocationFailures: 0 })
    .where(eq(broadcasts.id, id));

/** The first recorded end stands, so a repeated stop cannot move completion. */
export const recordFinalMediaEnd = (
  tx: Tx,
  input: { readonly id: string; readonly at: Date },
) =>
  tx
    .update(broadcasts)
    .set({ finalMediaEndAt: input.at })
    .where(
      and(eq(broadcasts.id, input.id), isNull(broadcasts.finalMediaEndAt)),
    );

export const completeBroadcast = (
  tx: Tx,
  input: { readonly id: string; readonly at: Date },
) =>
  tx
    .update(broadcasts)
    .set({ completedAt: input.at, leaseOwner: null, leaseUntil: null })
    .where(and(eq(broadcasts.id, input.id), isNull(broadcasts.completedAt)));

/** Every public object is gone; a finished Broadcast is not claimed again. */
export const recordFeedWithdrawn = (
  tx: Tx,
  input: { readonly id: string; readonly at: Date },
) =>
  tx
    .update(broadcasts)
    .set({ feedWithdrawnAt: input.at })
    .where(eq(broadcasts.id, input.id));

/**
 * What Stream this Round needs to decide whether a Round has an official feed,
 * from the visibility frozen on the Round. A Round with no Broadcast has none.
 */
export const readOfficialFeedFacts = async (
  tx: Tx,
  input: { readonly roundId: string },
) => {
  const [row] = await tx
    .select({
      broadcastId: broadcasts.id,
      visibility: rounds.visibility,
      stoppedAt: broadcasts.stoppedAt,
      completedAt: broadcasts.completedAt,
    })
    .from(broadcasts)
    .innerJoin(rounds, eq(rounds.id, broadcasts.roundId))
    .where(eq(broadcasts.roundId, input.roundId));
  return row ?? null;
};

/** Every open Broadcast's reconcile facts, oldest first. */
export const listOpenBroadcasts = (tx: Tx, limit: number) =>
  tx
    .select()
    .from(broadcasts)
    .where(isNull(broadcasts.completedAt))
    .orderBy(asc(broadcasts.createdAt))
    .limit(limit);

/**
 * How far the audience's timeline has reached for this Round, and whether its
 * Broadcast was stopped. One rule with every other read: `spectatorHorizonSql`.
 */
export const readBroadcastRelease = async (
  reader: Pick<BoundedTransactionContext, 'execute'>,
  roundId: string,
  clock: SpectatorClock,
) => {
  const rows = await reader.execute(sql`
    select ${spectatorHorizonSql(roundAliasR, clock)} as horizon,
      exists (select 1 from broadcasts b where b.round_id = r.id and b.stopped_at is not null) as stopped
    from rounds r where r.id = ${roundId}`);
  const [row] = rows as unknown as {
    readonly horizon: Date | string | null;
    readonly stopped: boolean;
  }[];
  return {
    releasedThroughMs:
      row?.horizon === null || row?.horizon === undefined
        ? null
        : new Date(row.horizon).getTime(),
    stopped: row?.stopped ?? false,
  };
};

/** Ranked Rounds still running with no Broadcast yet. Read-only; takes no Round lock. */
export const discoverUnopenedBroadcastRounds = async (tx: Tx, limit: number) =>
  tx
    .select({
      roundId: rounds.id,
      competitionType: rounds.competitionType,
      capture: rounds.capture,
    })
    .from(rounds)
    .leftJoin(broadcasts, eq(broadcasts.roundId, rounds.id))
    .where(
      and(
        or(
          eq(rounds.competitionType, 'ranked'),
          sql`jsonb_typeof(${rounds.capture} -> 'broadcast') = 'object'`,
        ),
        inArray(rounds.status, ['opening', 'active']),
        isNull(broadcasts.id),
      ),
    )
    .limit(limit);

/** The room the observer currently belongs in; rotation moves it (ADR 0099). */
export const readBroadcastRoom = async (tx: Tx, roundId: string) => {
  const [session] = await tx
    .select({ roomName: mediaSessions.roomName })
    .from(mediaSessions)
    .where(eq(mediaSessions.roundId, roundId));
  return session?.roomName ?? null;
};

/** True for the one instance that may reconcile this Broadcast until the lease ends. */
export const claimBroadcastReconcile = async (
  tx: Tx,
  input: { readonly id: string; readonly now: Date; readonly until: Date },
): Promise<boolean> => {
  const rows = await tx
    .update(broadcasts)
    .set({ reconcileLeaseUntil: input.until })
    .where(
      and(
        eq(broadcasts.id, input.id),
        or(
          isNull(broadcasts.reconcileLeaseUntil),
          lte(broadcasts.reconcileLeaseUntil, input.now),
        ),
      ),
    )
    .returning({ id: broadcasts.id });
  return rows.length === 1;
};

/**
 * Whether private conversation must wait for this Round's observer. Held for as
 * long as an open Broadcast's observer may still be subscribed, with no timer: an
 * unconfirmed revocation stops the Egress, and revoking an observer that has gone
 * then confirms. A dead control plane costs conversation only, never speech.
 */
export const readConversationHeld = async (
  tx: Tx,
  input: { readonly roundId: string },
): Promise<boolean> => {
  const [broadcast] = await tx
    .select({
      revokedAt: broadcasts.observerRevokedAt,
      stoppedAt: broadcasts.stoppedAt,
      completedAt: broadcasts.completedAt,
      egressId: broadcasts.egressId,
    })
    .from(broadcasts)
    .where(eq(broadcasts.roundId, input.roundId));
  if (
    broadcast !== undefined &&
    broadcast.egressId !== null &&
    broadcast.stoppedAt === null &&
    broadcast.completedAt === null &&
    broadcast.revokedAt === null
  )
    return true;
  // A Recording with no Broadcast runs the same observer under the same rule.
  const [own] = await tx
    .select({ id: recordingCaptures.recordingId })
    .from(recordingCaptures)
    .where(
      and(
        eq(recordingCaptures.roundId, input.roundId),
        isNull(recordingCaptures.endedAt),
        isNull(recordingCaptures.observerRevokedAt),
        isNotNull(recordingCaptures.egressId),
      ),
    );
  return own !== undefined;
};

/**
 * An operator stops a Broadcast (WATCH-7). The reconciler then stops its
 * Egress, and the stop stands: a repeat, or a Broadcast already complete, is
 * `unchanged`. Null when there is no such Broadcast.
 */
export const stopBroadcast = async (
  tx: Tx,
  input: {
    readonly id: string;
    readonly reason: string;
    readonly now: Date;
  },
): Promise<'applied' | 'unchanged' | null> => {
  const stopped = await tx
    .update(broadcasts)
    .set({ stoppedAt: input.now, stopReason: input.reason })
    .where(
      and(
        eq(broadcasts.id, input.id),
        isNull(broadcasts.stoppedAt),
        isNull(broadcasts.completedAt),
      ),
    )
    .returning({ id: broadcasts.id });
  if (stopped.length === 1) return 'applied';
  const [found] = await tx
    .select({ id: broadcasts.id })
    .from(broadcasts)
    .where(eq(broadcasts.id, input.id));
  return found ? 'unchanged' : null;
};
