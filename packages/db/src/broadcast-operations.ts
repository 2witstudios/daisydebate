import type { BroadcastReleasePolicy } from '@daisy/protocol';
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { controlHeartbeat } from './control-heartbeat';
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
    readonly feedKey: string;
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

type ClaimLease = {
  readonly owner: string;
  readonly now: Date;
  readonly leaseUntil: Date;
};

/** Takes the oldest free row of `work`. The epoch fences the last owner. */
const claimOldestFree = async (tx: Tx, work: SQL, input: ClaimLease) => {
  const [free] = await tx
    .select({ id: broadcasts.id })
    .from(broadcasts)
    .where(
      and(
        work,
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

/**
 * Takes the oldest Broadcast still releasing whose lease is free, once something
 * in it can be due. A hold for the Round's end or a set time has nothing to do
 * until then, so it occupies no release slot.
 */
export const claimBroadcast = (tx: Tx, input: ClaimLease) =>
  claimOldestFree(
    tx,
    and(
      isNull(broadcasts.completedAt),
      isNull(broadcasts.stoppedAt),
      sql`not (${broadcasts.releasePolicy} ->> 'kind' = 'round_end' and ${broadcasts.finalMediaEndAt} is null)`,
      sql`not (${broadcasts.releasePolicy} ->> 'kind' = 'at' and (${broadcasts.releasePolicy} ->> 'atMs')::bigint > ${input.now.getTime()}::bigint)`,
    )!,
    input,
  );

/**
 * Takes the oldest Broadcast whose public feed must go, apart from release
 * claims so a takedown never waits for a Round to free a slot: a stopped one at
 * once, a completed one once `withdrawFinishedBefore` has passed its completion,
 * and a stopped one again once its Egress is known gone, so it can complete. A
 * lease still held means a live holder, which sees the stop at its next renewal,
 * or a dead one, which expires: taking it sooner could let that holder's last
 * upload land after the delete.
 */
export const claimFeedWithdrawal = (
  tx: Tx,
  input: ClaimLease & { readonly withdrawFinishedBefore: Date },
) =>
  claimOldestFree(
    tx,
    or(
      and(
        isNull(broadcasts.feedWithdrawnAt),
        or(
          isNotNull(broadcasts.stoppedAt),
          isNotNull(broadcasts.feedWithdrawalRequestedAt),
          lte(broadcasts.completedAt, input.withdrawFinishedBefore),
        ),
      ),
      and(
        isNotNull(broadcasts.stoppedAt),
        isNull(broadcasts.completedAt),
        isNotNull(broadcasts.finalMediaEndAt),
      ),
    )!,
    input,
  );

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

/**
 * Time history has settled as not public has passed with nothing to release: the
 * timeline moves on, so a long prep or judging reads as what it is, not as a stalled
 * release. It publishes nothing, and it never recedes.
 */
export const recordNotPublicPassed = async (
  tx: Tx,
  input: {
    readonly id: string;
    readonly owner: string;
    readonly epoch: number;
    readonly through: Date;
  },
): Promise<boolean> => {
  const rows = await tx
    .update(broadcasts)
    .set({
      releasedThroughAt: sql`greatest(${broadcasts.releasedThroughAt}, ${input.through.toISOString()}::timestamptz)`,
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

/**
 * One Egress per generation: the first report wins, and false tells any other to
 * stop what it started. A loser's credential is never stored, so its stage page
 * is refused, never signals Egress to record and writes nothing.
 */
export const recordEgressStarted = async (
  tx: Tx,
  input: {
    readonly id: string;
    readonly egressId: string;
    readonly generation: number;
    readonly stageCredentialHash: string;
    readonly now: Date;
  },
): Promise<boolean> => {
  const rows = await tx
    .update(broadcasts)
    .set({
      egressId: input.egressId,
      egressGeneration: input.generation,
      revocationFailures: 0,
      stageCredentialHash: input.stageCredentialHash,
      egressStartedAt: input.now,
      ...controlHeartbeat(),
    })
    .where(
      and(
        eq(broadcasts.id, input.id),
        eq(broadcasts.egressGeneration, input.generation - 1),
      ),
    )
    .returning({ id: broadcasts.id });
  return rows.length === 1;
};

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

/** One page of open Broadcasts' reconcile facts; `after` reaches every one in a pass. */
export const listOpenBroadcasts = (
  tx: Tx,
  limit: number,
  after: string | null = null,
) =>
  tx
    .select()
    .from(broadcasts)
    .where(
      and(
        isNull(broadcasts.completedAt),
        after === null ? undefined : gt(broadcasts.id, after),
      ),
    )
    .orderBy(asc(broadcasts.id))
    .limit(limit);

/**
 * How a Broadcast's feed came to end, as far as its audience's video goes: an
 * operator's stop holds the video back, and any other end leaves that to the
 * Recording's own state.
 */
export type BroadcastStop = 'none' | 'feed_ended' | 'media_withheld';

export const broadcastStopOf = (
  stopped: boolean,
  mediaWithheld: boolean | null,
): BroadcastStop =>
  !stopped ? 'none' : mediaWithheld ? 'media_withheld' : 'feed_ended';

/**
 * How far the audience's timeline has reached for this Round, and how its
 * Broadcast was stopped. One rule with every other read: `spectatorHorizonSql`.
 */
export const readBroadcastRelease = async (
  reader: Pick<BoundedTransactionContext, 'execute'>,
  roundId: string,
  clock: SpectatorClock,
) => {
  const rows = await reader.execute(sql`
    select ${spectatorHorizonSql(roundAliasR, clock)} as horizon,
      exists (select 1 from broadcasts b where b.round_id = r.id and b.stopped_at is not null) as stopped,
      exists (select 1 from broadcasts b where b.round_id = r.id and b.media_withheld) as withheld
    from rounds r where r.id = ${roundId}`);
  const [row] = rows as unknown as {
    readonly horizon: Date | string | null;
    readonly stopped: boolean;
    readonly withheld: boolean;
  }[];
  return {
    releasedThroughMs:
      row?.horizon === null || row?.horizon === undefined
        ? null
        : new Date(row.horizon).getTime(),
    stop: broadcastStopOf(row?.stopped ?? false, row?.withheld ?? false),
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

/**
 * True for the one instance that may reconcile this Broadcast until the lease
 * ends. A claim is also the control plane's heartbeat for it.
 */
export const claimBroadcastReconcile = async (
  tx: Tx,
  input: { readonly id: string; readonly now: Date; readonly until: Date },
): Promise<boolean> => {
  const rows = await tx
    .update(broadcasts)
    .set({
      reconcileLeaseUntil: input.until,
      ...controlHeartbeat(),
    })
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
 * The worker's one read of a Round: the committed times of its speeches and private
 * spans, through views that hold nothing else, because its role reaches no Round table.
 */
export const readBroadcastStageHistory = async (
  tx: Pick<BoundedTransactionContext, 'execute'>,
  broadcastId: string,
) => {
  const segments = (await tx.execute(sql`
    select started_at, ended_at, duration_ms from broadcast_public_history
    where broadcast_id = ${broadcastId} order by sequence`)) as unknown as {
    readonly started_at: Date | string;
    readonly ended_at: Date | string | null;
    readonly duration_ms: number;
  }[];
  const spans = (await tx.execute(sql`
    select kind, started_at, ended_at from broadcast_private_history
    where broadcast_id = ${broadcastId}`)) as unknown as {
    readonly kind: 'prep' | 'judging';
    readonly started_at: Date | string;
    readonly ended_at: Date | string | null;
  }[];
  const ms = (at: Date | string | null) =>
    at === null ? null : new Date(at).getTime();
  return {
    segments: segments.map((row) => ({
      startedAtMs: ms(row.started_at)!,
      endedAtMs: ms(row.ended_at),
      durationMs: row.duration_ms,
    })),
    privateSpans: spans.map((row) => ({
      kind: row.kind,
      startedAtMs: ms(row.started_at)!,
      endedAtMs: ms(row.ended_at),
    })),
  };
};

/** Whether this Broadcast's Round has a Recording, which reads its hold, then clears it. */
export const readRecordingKeepsHold = async (
  tx: Pick<BoundedTransactionContext, 'execute'>,
  broadcastId: string,
) => {
  const rows = (await tx.execute(sql`
    select 1 from broadcast_recording_claims
    where broadcast_id = ${broadcastId}`)) as unknown as unknown[];
  return rows.length > 0;
};

/** Keeps the claim across a call that outlasts it; null `until` gives it back. */
export const holdBroadcastReconcile = (
  tx: Tx,
  input: { readonly id: string; readonly until: Date | null },
) =>
  tx
    .update(broadcasts)
    .set({ reconcileLeaseUntil: input.until })
    .where(eq(broadcasts.id, input.id));

/** The Egress this Broadcast recorded as its own; null when no such Broadcast. */
export const readBroadcastEgress = async (tx: Tx, id: string) => {
  const [row] = await tx
    .select({ egressId: broadcasts.egressId })
    .from(broadcasts)
    .where(eq(broadcasts.id, id));
  return row ?? null;
};

/** Whether a Broadcast's observer may still be subscribed to this Round. */
export const readBroadcastObserverHeld = async (
  tx: Tx,
  input: { readonly roundId: string },
): Promise<boolean> => {
  const [broadcast] = await tx
    .select({ id: broadcasts.id })
    .from(broadcasts)
    .where(
      and(
        eq(broadcasts.roundId, input.roundId),
        isNotNull(broadcasts.egressId),
        isNull(broadcasts.stoppedAt),
        isNull(broadcasts.completedAt),
        isNull(broadcasts.observerRevokedAt),
      ),
    );
  return broadcast !== undefined;
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
  if (await readBroadcastObserverHeld(tx, input)) return true;
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
 * Ends a Broadcast's feed, for whatever must not keep playing. The reconciler then
 * stops its Egress, and the stop stands: a repeat, or a Broadcast already complete,
 * is `unchanged`, though the complete one's feed is asked to go at once. Null when
 * there is no such Broadcast.
 */
export const endBroadcastFeed = async (
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
  // Already complete, its feed would wait out the grace: past the delivery bound
  // for a stop that lands just after. The withdrawal loop takes it on its next poll.
  await tx
    .update(broadcasts)
    .set({ feedWithdrawalRequestedAt: input.now })
    .where(
      and(
        eq(broadcasts.id, input.id),
        isNotNull(broadcasts.completedAt),
        isNull(broadcasts.feedWithdrawnAt),
        isNull(broadcasts.feedWithdrawalRequestedAt),
      ),
    );
  const [found] = await tx
    .select({ id: broadcasts.id })
    .from(broadcasts)
    .where(eq(broadcasts.id, input.id));
  return found ? 'unchanged' : null;
};

/**
 * An operator stops a Broadcast (WATCH-7): its feed ends and its video is held back
 * from the audience, even if something else had already ended the feed.
 */
export const stopBroadcast = async (
  tx: Tx,
  input: {
    readonly id: string;
    readonly reason: string;
    readonly now: Date;
  },
): Promise<'applied' | 'unchanged' | null> => {
  const ended = await endBroadcastFeed(tx, input);
  const withheld = await tx
    .update(broadcasts)
    .set({ mediaWithheld: true })
    .where(
      and(
        eq(broadcasts.id, input.id),
        isNotNull(broadcasts.stoppedAt),
        eq(broadcasts.mediaWithheld, false),
      ),
    )
    .returning({ id: broadcasts.id });
  return withheld.length === 1 ? 'applied' : ended;
};
