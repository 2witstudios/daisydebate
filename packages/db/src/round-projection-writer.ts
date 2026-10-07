import { createAppError } from '@daisy/errors';
import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { RoundProjection } from '@daisy/protocol';
import { isUniqueViolation } from './unique-violation';
import { roundSegments } from './schema/round-segments';
import { rounds } from './schema/rounds';

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
  recorded: string,
) =>
  projected === recorded
    ? sql`coalesce(${column}, statement_timestamp())`
    : column;

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
          projection.round.status,
          'active',
        ),
        completedAt: lifecycleInstant(
          rounds.completedAt,
          projection.round.status,
          'completed',
        ),
        outcome: projection.round.outcome,
        runtimeState: projection.round.checkpoint,
        version: sql`${rounds.version} + 1`,
        updatedAt: sql`statement_timestamp()`,
      })
      .where(eq(rounds.id, roundId));
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
  for (const close of projection.segmentCloses) {
    await tx
      .update(roundSegments)
      .set({ endedAt: new Date(close.endedAt) })
      .where(
        and(eq(roundSegments.id, close.id), eq(roundSegments.roundId, roundId)),
      );
  }
}
