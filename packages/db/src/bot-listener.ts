import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { BoundedTransaction } from './bounded-transaction';
import type { BoundedTransactionContext } from './transaction-context';
import { mediaWorkerLeaseEpoch } from './media-worker-lease';
import { readSessionSeats, readSpeakingIntervals } from './media-session-reads';
import { botListenerLeases } from './schema/bot-listener-leases';
import { roundSegments } from './schema/round-segments';

const epoch = z.number().int().positive().max(2147483647);
const scope = { roundId: idSchema, sessionId: idSchema, workerId: idSchema };
const leaseRequestSchema = z.strictObject({
  ...scope,
  leaseMs: z.number().int().min(1000).max(30000),
  expectedEpoch: epoch.optional(),
});
const identitySchema = z.strictObject({ ...scope, epoch });
const leaseCheckSchema = identitySchema.safeExtend({ segmentId: idSchema });

const listenerLeaseRefusals = {
  held: 'Bot listener lease is held',
  stale: 'Bot listener lease is stale',
  exhausted: 'Bot listener epoch exhausted',
};
const parse = <T>(schema: z.ZodType<T>, raw: unknown) => {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw createAppError('VALIDATION');
  return parsed.data;
};
const stale = () => createAppError('CONFLICT', listenerLeaseRefusals.stale);
const serverNow = sql`to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** The session must be this Round's, live, and its Round still playing; returns PostgreSQL time. */
async function requireLiveSession(
  tx: BoundedTransactionContext,
  input: { readonly roundId: string; readonly sessionId: string },
) {
  const [row] = (await tx.execute(sql`select ${serverNow} as now
    from media_sessions s join rounds r on r.id=s.round_id
    where s.id=${input.sessionId} and s.round_id=${input.roundId}
      and s.ended_at is null and s.unsafe_at is null
      and s.deletion_requested_at is null
      and r.status in ('scheduled','active')`)) as unknown as {
    now: string;
  }[];
  if (!row) throw createAppError('CONFLICT', 'Bot listener session is closed');
  return new Date(row.now);
}

/**
 * This worker's current epoch on a live session, and `segmentId` still open
 * when named, in one statement; returns fresh PostgreSQL time.
 */
async function requireCurrentLease(
  tx: BoundedTransactionContext,
  input: z.infer<typeof identitySchema> & { readonly segmentId?: string },
) {
  const segmentOpen = input.segmentId
    ? sql`and exists(select 1 from round_segments g where g.id=${input.segmentId}
        and g.round_id=s.round_id and g.ended_at is null)`
    : sql``;
  const [row] = (await tx.execute(sql`select ${serverNow} as "serverNow"
    from bot_listener_leases l
    join media_sessions s on s.id=l.session_id
    where l.session_id=${input.sessionId} and s.round_id=${input.roundId}
      and l.worker_id=${input.workerId} and l.epoch=${input.epoch}
      and l.expires_at>clock_timestamp()
      and s.ended_at is null and s.unsafe_at is null
      and s.deletion_requested_at is null ${segmentOpen}`)) as unknown as {
    serverNow: string;
  }[];
  if (!row) throw stale();
  return row.serverNow;
}

/** Every page of a segment's speaking grants; a cross-ex holds few. */
async function allSpeakingIntervals(
  tx: BoundedTransactionContext,
  roundId: string,
  segmentId: string,
) {
  const intervals: {
    roundParticipantId: string;
    startedAt: string;
    endedAt: string | null;
  }[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await readSpeakingIntervals(tx, roundId, segmentId, after);
    for (const { roundParticipantId, startedAt, endedAt } of page.intervals)
      intervals.push({ roundParticipantId, startedAt, endedAt });
    if (!page.nextIntervalId) return intervals;
    after = page.nextIntervalId;
  }
}

/** The Round's open segment and the window it may run. */
async function readOpenSegment(tx: BoundedTransactionContext, roundId: string) {
  const [segment] = await tx
    .select({
      id: roundSegments.id,
      type: roundSegments.type,
      startedAt: roundSegments.startedAt,
      durationMs: roundSegments.durationMs,
    })
    .from(roundSegments)
    .where(
      and(eq(roundSegments.roundId, roundId), isNull(roundSegments.endedAt)),
    )
    .orderBy(desc(roundSegments.sequence))
    .limit(1);
  return segment
    ? { ...segment, startedAt: segment.startedAt.toISOString() }
    : null;
}

/**
 * The bot listener's own lease and reads (ISSUE-764): admitted only by
 * `bot_listener_leases`, never by the capture lease, under the one media
 * worker claim rule and seat read capture also uses. Nothing here reads or
 * writes capture state.
 */
export const botListenerOperations = (transaction: BoundedTransaction) => ({
  /** Claims or renews the session's listener lease. */
  claimBotListenerLease(raw: unknown) {
    const input = parse(leaseRequestSchema, raw);
    return transaction(async (tx) => {
      const now = await requireLiveSession(tx, input);
      const [current] = await tx
        .select()
        .from(botListenerLeases)
        .where(eq(botListenerLeases.sessionId, input.sessionId))
        .for('update');
      const next = mediaWorkerLeaseEpoch(
        current,
        input,
        now,
        listenerLeaseRefusals,
      );
      const expiresAt = new Date(now.getTime() + input.leaseMs);
      await tx
        .insert(botListenerLeases)
        .values({
          sessionId: input.sessionId,
          workerId: input.workerId,
          epoch: next,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: botListenerLeases.sessionId,
          set: { workerId: input.workerId, epoch: next, expiresAt },
        });
      return { epoch: next, expiresAt: expiresAt.toISOString() };
    });
  },
  /**
   * What the listener needs under its current lease: the open segment and
   * its speaking grants (so it relays only a seat holding the floor), the
   * non-judge seats with their bound identities, and fresh PostgreSQL time
   * for its clock calibration.
   */
  readBotListenerState(raw: unknown) {
    const input = parse(identitySchema, raw);
    return transaction(async (tx) => {
      const now = await requireCurrentLease(tx, input);
      const segment = await readOpenSegment(tx, input.roundId);
      return {
        roundId: input.roundId,
        sessionId: input.sessionId,
        serverNow: now,
        segment,
        participants: await readSessionSeats(
          tx,
          input.roundId,
          input.sessionId,
        ),
        intervals: segment
          ? await allSpeakingIntervals(tx, input.roundId, segment.id)
          : [],
      };
    });
  },
  /**
   * The per-batch check, one statement: this worker's epoch, an unexpired
   * lease, a session not ended, unsafe or being deleted, and the batch's
   * segment still open.
   */
  readCurrentBotListenerLease(raw: unknown) {
    const input = parse(leaseCheckSchema, raw);
    return transaction(async (tx) => ({
      serverNow: await requireCurrentLease(tx, input),
    }));
  },
});
