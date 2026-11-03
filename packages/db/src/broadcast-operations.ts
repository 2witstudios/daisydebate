import type { BroadcastReleasePolicy } from '@daisy/protocol';
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';
import { broadcasts } from './schema/broadcasts';
import { mediaSessions } from './schema/media-sessions';
import { rounds } from './schema/rounds';

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
export const recordEgressStarted = (
  tx: Tx,
  input: {
    readonly id: string;
    readonly egressId: string;
    readonly stageCredentialHash: string;
    readonly now: Date;
  },
) =>
  tx
    .update(broadcasts)
    .set({
      egressId: input.egressId,
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

/** Every open Broadcast's reconcile facts, oldest first. */
export const listOpenBroadcasts = (tx: Tx, limit: number) =>
  tx
    .select()
    .from(broadcasts)
    .where(isNull(broadcasts.completedAt))
    .orderBy(asc(broadcasts.createdAt))
    .limit(limit);

/**
 * What the Broadcast has released, for features that hold facts back until it
 * has: no Broadcast at all, the watermark, or complete.
 */
export const readBroadcastRelease = async (
  reader: Pick<Tx, 'select'>,
  roundId: string,
) => {
  const [row] = await reader
    .select({
      at: broadcasts.releasedThroughAt,
      completedAt: broadcasts.completedAt,
    })
    .from(broadcasts)
    .where(eq(broadcasts.roundId, roundId));
  if (!row) return { kind: 'none' } as const;
  if (row.completedAt) return { kind: 'completed' } as const;
  return {
    kind: 'open',
    releasedThroughMs: row.at?.getTime() ?? null,
  } as const;
};

/** Ranked Rounds still running with no Broadcast yet. Read-only; takes no Round lock. */
export const discoverUnopenedRankedRounds = async (tx: Tx, limit: number) =>
  tx
    .select({ roundId: rounds.id })
    .from(rounds)
    .leftJoin(broadcasts, eq(broadcasts.roundId, rounds.id))
    .where(
      and(
        eq(rounds.competitionType, 'ranked'),
        inArray(rounds.status, ['scheduled', 'active']),
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

/** How long a dead control plane can hold conversation; past it the mic opens. */
const CONVERSATION_HOLD_LIMIT_MS = 3000;

/**
 * Whether private conversation must wait for this Round's observer. True only
 * while an open Broadcast's observer is unrevoked, and only up to the limit from the
 * private phase's start, or from the Egress's start before the first segment, so a Broadcast can delay the debate by seconds and never stop it.
 */
export const readConversationHeld = async (
  tx: Tx,
  input: {
    readonly roundId: string;
    readonly now: Date;
    readonly privateSince: Date | null;
  },
): Promise<boolean> => {
  const [row] = await tx
    .select({
      revokedAt: broadcasts.observerRevokedAt,
      stoppedAt: broadcasts.stoppedAt,
      completedAt: broadcasts.completedAt,
      egressId: broadcasts.egressId,
      egressStartedAt: broadcasts.egressStartedAt,
    })
    .from(broadcasts)
    .where(eq(broadcasts.roundId, input.roundId));
  if (!row || row.stoppedAt || row.completedAt || row.revokedAt) return false;
  const since = input.privateSince ?? row.egressStartedAt;
  return (
    row.egressId !== null &&
    since !== null &&
    input.now.getTime() - since.getTime() < CONVERSATION_HOLD_LIMIT_MS
  );
};
