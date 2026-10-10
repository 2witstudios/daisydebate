import { createAppError } from '@daisy/errors';
import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { RoundProjection } from '@daisy/protocol';
import { buildDebateTopic } from '@daisy/protocol';
import type { z } from 'zod';
import { appendOutboxEvent } from './outbox';
import { jsonObjectSchema } from './schema/columns';
import { isUniqueViolation } from './unique-violation';
import { roundCommands } from './schema/round-commands';
import { roundSegments } from './schema/round-segments';
import { rounds } from './schema/rounds';

type Tx = Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0];

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

/** Persist a projection and announce exactly the revision it advances to. */
export async function writeProjectionWithPhaseSignal(
  tx: Tx,
  roundId: string,
  currentVersion: number,
  projection: RoundProjection,
): Promise<void> {
  await writeProjection(tx, roundId, projection);
  if (projection.round !== null)
    await appendRoundPhaseChanged(tx, roundId, currentVersion + 1);
}

/**
 * Locks the round row and refuses when it moved on: the optimistic-version
 * gate every durable round write shares, so a round that moved under a
 * concurrent write refuses with CONFLICT and writes nothing.
 */
export async function lockedRoundVersion(
  tx: Tx,
  roundId: string,
  expectedVersion: number,
): Promise<number> {
  const [round] = await tx
    .select({ version: rounds.version })
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .for('update');
  if (!round) throw createAppError('NOT_FOUND', 'No such round');
  if (round.version !== expectedVersion)
    throw createAppError('CONFLICT', 'The round moved on');
  return round.version;
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

/**
 * The durable instant for a lifecycle column (ADR 0033 §3.2, ISSUE-37):
 * `coalesce` on the *stored* column, so only the write that fills it in
 * chooses an instant and every write after it keeps the one already recorded.
 *
 * The previous form took the transition from the projection's status, which
 * meant any write made while the round was active re-stamped `started_at` — a
 * segment closing halfway through a debate moved the round's start forward,
 * and the timetable and rating window read exactly this column. Comparing
 * against the stored column is what makes it a transition again: the round
 * that opens at T keeps its start at T however many commands follow, and two
 * concurrent writers cannot both claim to be the one that started it.
 *
 * The projected value is never written. These columns are PostgreSQL's alone,
 * so no caller chooses them: hydration reads them back into the runtime and
 * the runtime carries them through.
 */
const lifecycleInstant = (
  column: typeof rounds.startedAt,
  projected: string | null,
) =>
  projected !== null ? sql`coalesce(${column}, statement_timestamp())` : column;

/** Writes one projection's round row and segment changes inside `tx`. */
export async function writeProjection(
  tx: Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0],
  roundId: string,
  projection: RoundProjection,
): Promise<void> {
  // `null` means no round-row column changed, so there is no lifecycle to
  // record. A scheduled round that a projection leaves scheduled writes its
  // `started_at` back unchanged, which is what makes the instant a transition.
  if (projection.round !== null) {
    await tx
      .update(rounds)
      .set({
        status: projection.round.status,
        currentStage: projection.round.currentStage,
        // The runtime is still pure — it receives `now` from
        // `databaseNow()`, the same clock — so segment instants agree with
        // the lifecycle columns to within the request's latency rather than
        // drifting onto a second clock.
        startedAt: lifecycleInstant(
          rounds.startedAt,
          projection.round.startedAt,
        ),
        completedAt: lifecycleInstant(
          rounds.completedAt,
          projection.round.completedAt,
        ),
        outcome: projection.round.outcome,
        runtimeState: projection.round.checkpoint,
        version: sql`${rounds.version} + 1`,
        updatedAt: sql`statement_timestamp()`,
      })
      .where(eq(rounds.id, roundId));
  }
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
