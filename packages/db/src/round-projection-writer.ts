import { TRANSCRIPT_ADMISSION_WINDOW_MS } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { RoundProjection } from '@daisy/protocol';
import { runtimeCheckpointSchema, buildDebateTopic } from '@daisy/protocol';
import type { z } from 'zod';
import { appendOutboxEvent } from './outbox';
import { refundUnservedPracticeLocked } from './round-bot-admission';
import { releaseRoundRoomMembers } from './room-membership-persistence';
import { jsonObjectSchema } from './schema/columns';
import { isUniqueViolation } from './unique-violation';
import { roundCommands } from './schema/round-commands';
import { roundSegments } from './schema/round-segments';
import { rounds } from './schema/rounds';

type Tx = Pick<BunSQLDatabase, 'select' | 'update' | 'insert' | 'execute'>;

/** Append the canonical content-free invalidation for a persisted Round revision. */
export async function appendRoundPhaseChanged(
  tx: Tx,
  roundId: string,
  entityVersion: number,
): Promise<void> {
  await appendOutboxEvent(tx, {
    topic: buildDebateTopic(roundId),
    kind: 'debate.phase-changed',
    version: 1,
    payload: {
      kind: 'debate.phase-changed',
      ids: [roundId],
      entityVersion,
    },
  });
}

const projectionChanged = (
  current: LockedRound,
  projection: RoundProjection,
): boolean => {
  const projected = projection.round;
  if (
    projection.segmentInserts.length > 0 ||
    projection.segmentCloses.length > 0
  )
    return true;
  if (projected === null) return false;
  const previous = {
    status: current.status,
    currentStage: current.currentStage,
    startedAt: current.startedAt?.toISOString() ?? null,
    completedAt: current.completedAt?.toISOString() ?? null,
    outcome: current.outcome,
    checkpoint: runtimeCheckpointSchema.parse(current.runtimeState),
  };
  const next = {
    ...projected,
    checkpoint: runtimeCheckpointSchema.parse(projected.checkpoint),
  };
  return Object.entries(previous).some(
    ([key, value]) =>
      JSON.stringify(value) !== JSON.stringify(next[key as keyof typeof next]),
  );
};

const terminal = new Set(['completed', 'abandoned']);
/** The projection is the one that takes the Round out of play. */
const endsRound = (current: LockedRound, projection: RoundProjection) =>
  projection.round !== null &&
  terminal.has(projection.round.status) &&
  !terminal.has(current.status);

/** Persist a projection and announce exactly the revision it advances to. */
export async function writeProjectionWithPhaseSignal(
  tx: Tx,
  roundId: string,
  current: LockedRound,
  projection: RoundProjection,
  now: string,
): Promise<boolean> {
  const changed = projectionChanged(current, projection);
  if (!changed) return false;
  await writeProjection(tx, roundId, projection, now);
  if (endsRound(current, projection)) {
    await refundUnservedPracticeLocked(tx, roundId);
    await releaseRoundRoomMembers(tx, roundId);
  }
  if (projection.finalSegmentEndedAt !== undefined)
    await tx
      .update(rounds)
      .set({
        finalSegmentEndedAt: new Date(projection.finalSegmentEndedAt),
        transcriptAdmissionCutoff: new Date(
          Date.parse(projection.finalSegmentEndedAt) +
            TRANSCRIPT_ADMISSION_WINDOW_MS,
        ),
      })
      .where(
        and(eq(rounds.id, roundId), sql`${rounds.finalSegmentEndedAt} is null`),
      );
  await appendRoundPhaseChanged(tx, roundId, current.version + 1);
  return true;
}

type LockedRound = {
  readonly version: number;
  readonly status: typeof rounds.$inferSelect.status;
  readonly currentStage: typeof rounds.$inferSelect.currentStage;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly outcome: typeof rounds.$inferSelect.outcome;
  readonly runtimeState: typeof rounds.$inferSelect.runtimeState;
};

/**
 * Locks the round row and refuses when it moved on: the optimistic-version
 * gate every durable round write shares. Non-key locking admits durable child
 * evidence through FK KEY SHARE while excluding competing writers and erasure.
 * A round that moved under a
 * concurrent write refuses with CONFLICT and writes nothing.
 */
export async function lockedRoundVersion(
  tx: Tx,
  roundId: string,
  expectedVersion?: number,
): Promise<LockedRound> {
  const [round] = await tx
    .select({
      version: rounds.version,
      status: rounds.status,
      currentStage: rounds.currentStage,
      startedAt: rounds.startedAt,
      completedAt: rounds.completedAt,
      outcome: rounds.outcome,
      runtimeState: rounds.runtimeState,
    })
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .for('no key update');
  if (!round) throw createAppError('NOT_FOUND', 'No such round');
  if (expectedVersion !== undefined && round.version !== expectedVersion)
    throw createAppError('CONFLICT', 'The round moved on');
  return round;
}

/**
 * Writes the applied command row — idempotency and audit — with the version
 * the execution leaves the round at. Null command, no row.
 */
export async function insertCommandRow(
  tx: Tx,
  roundId: string,
  command: {
    readonly commandId: string;
    readonly actorId: string | null;
    readonly serviceId: string | null;
    readonly type: string;
    readonly payloadDigest: string;
    readonly result: z.infer<typeof jsonObjectSchema>;
  } | null,
  resultingVersion: number,
): Promise<void> {
  if (command === null) return;
  await tx.insert(roundCommands).values({
    commandId: command.commandId,
    roundId,
    actorId: command.actorId,
    serviceId: command.serviceId,
    type: command.type,
    payloadDigest: command.payloadDigest,
    result: command.result,
    resultingVersion,
    appliedAt: sql`statement_timestamp()` as unknown as Date,
  });
}

/** Lifecycle instants belong to the post-lock database sample. Existing stamps remain fixed. */
const lifecycleInstant = (
  column: typeof rounds.startedAt,
  projected: string | null,
  now: string,
) => (projected !== null ? sql`coalesce(${column}, ${new Date(now)})` : column);

/** Writes one projection's round row and segment changes inside `tx`. */
async function writeProjection(
  tx: Tx,
  roundId: string,
  projection: RoundProjection,
  now: string,
): Promise<void> {
  const lifecycle = projection.round;
  await tx
    .update(rounds)
    .set({
      ...(lifecycle === null
        ? {}
        : {
            status: lifecycle.status,
            currentStage: lifecycle.currentStage,
            startedAt: lifecycleInstant(
              rounds.startedAt,
              lifecycle.startedAt,
              now,
            ),
            completedAt: lifecycleInstant(
              rounds.completedAt,
              lifecycle.completedAt,
              now,
            ),
            outcome: lifecycle.outcome,
            runtimeState: lifecycle.checkpoint,
          }),
      version: sql`${rounds.version} + 1`,
      updatedAt: sql`statement_timestamp()`,
    })
    .where(eq(rounds.id, roundId));
  // The open-segment index is immediate: close the previous interval before
  // opening its successor in the same transaction.
  const insertedIds = new Set(projection.segmentInserts.map((row) => row.id));
  const closes = new Map(
    projection.segmentCloses.map((row) => [row.id, row.endedAt]),
  );
  for (const close of projection.segmentCloses) {
    if (insertedIds.has(close.id)) continue;
    await tx
      .update(roundSegments)
      .set({ endedAt: new Date(close.endedAt) })
      .where(
        and(eq(roundSegments.id, close.id), eq(roundSegments.roundId, roundId)),
      );
  }
  for (const insert of projection.segmentInserts) {
    try {
      await tx.insert(roundSegments).values({
        id: insert.id,
        roundId,
        sequence: insert.sequence,
        type: insert.type,
        rulesSegmentKey: insert.rulesSegmentKey,
        startedAt: new Date(insert.startedAt),
        durationMs: insert.durationMs,
        endedAt: closes.has(insert.id)
          ? new Date(closes.get(insert.id)!)
          : null,
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw createAppError(
          'INVARIANT',
          'A segment opened over an open row',
          error,
        );
      throw error;
    }
  }
}
