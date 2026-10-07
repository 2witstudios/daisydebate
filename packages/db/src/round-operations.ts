import type {
  Ballot,
  DebateRole,
  RoundProjection,
  RoundRules,
  RuntimeCheckpoint,
  SegmentType,
} from '@daisy/protocol';
import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { ballotSchema } from '@daisy/protocol';
import type { z } from 'zod';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { isUniqueViolation } from './unique-violation';
import { roundParticipants } from './schema/round-participants';
import { roundCommands } from './schema/round-commands';
import { ballots } from './schema/ballots';
import { rounds } from './schema/rounds';
import { roundSegments } from './schema/round-segments';
import { jsonObjectSchema } from './schema/columns';

/**
 * A round hydrated for the runtime (ADR 0058 §4): the durable rows plus the
 * frozen rules and the checkpoint, everything `createRoundRuntime` needs.
 */
export type RoundHydration = {
  readonly id: string;
  readonly formatId: string;
  readonly formatVersion: number;
  readonly resolution: string;
  readonly status: 'scheduled' | 'active' | 'completed' | 'abandoned';
  readonly currentStage: 'countdown' | 'prep' | 'live' | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly outcome: 'affirmative' | 'negative' | 'draw' | null;
  readonly rules: RoundRules;
  readonly checkpoint: RuntimeCheckpoint;
  readonly version: number;
  readonly participants: readonly {
    readonly id: string;
    readonly actorId: string;
    readonly role: DebateRole;
    readonly slot: number;
  }[];
  readonly segments: readonly {
    readonly id: string;
    readonly sequence: number;
    readonly type: SegmentType;
    readonly rulesSegmentKey: string;
    readonly startedAt: string;
    readonly endedAt: string | null;
    readonly durationMs: number;
  }[];
};
/**
 * A runtime projection plus the command that produced it, persisted as one
 * transaction: the command row for idempotency and audit, the projection's
 * segment inserts and closes, and the round-row columns the projection
 * carries. The caller composes the pure runtime; this is only the write.
 */
export type RoundExecutionWrite = {
  readonly command: {
    readonly commandId: string;
    readonly actorId: string | null;
    readonly serviceId: string | null;
    readonly type: string;
    readonly payloadDigest: string;
    readonly result: z.infer<typeof jsonObjectSchema>;
  } | null;
  readonly projection: RoundProjection;
};

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
async function writeProjection(
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
        // The durable lifecycle instants are PostgreSQL's, never the
        // projection's (ADR 0033 §3.2, ISSUE-37): the timetable and the
        // rating window read these columns, so no caller may choose them, and
        // a later write must not restate the instant the transition recorded.
        // The runtime is still pure — it receives `now` from `databaseNow()`,
        // the same clock — so segment instants agree with these to within the
        // request's latency rather than drifting onto a second clock.
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

export const roundOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /**
   * One PostgreSQL instant for a whole execution (ADR 0033 §3.2, as amended
   * by ADR 0058): the caller reads it once, injects it as the runtime's
   * `now`, and every durable row that execution writes — the round row's
   * lifecycle columns and its segments — derives from it, so one aggregate
   * is never written from two clocks.
   */
  async databaseNow(): Promise<string> {
    return instrumented(eventSink, 'databaseNow', async () => {
      const [row] = (await database.execute(
        sql`select statement_timestamp() as now`,
      )) as unknown as Array<{ now: Date }>;
      if (!row)
        throw createAppError('INFRASTRUCTURE', 'The clock is unreadable');
      return row.now.toISOString();
    });
  },

  /**
   * Creates a round that froze without a Room — the foundation proof and
   * service-created rounds. Every value is already resolved by the caller;
   * the insert computes nothing.
   */
  async createRound(input: {
    readonly id: string;
    readonly createdByActorId: string | null;
    readonly resolution: string;
    readonly competitionType: 'ranked' | 'casual' | 'practice';
    readonly length: 'full' | 'quick';
    readonly formatId: string;
    readonly formatVersion: number;
    readonly presetVersion: number | null;
    readonly rules: RoundRules;
  }): Promise<void> {
    await instrumented(eventSink, 'createRound', async () => {
      const ladder =
        input.competitionType === 'ranked'
          ? input.length === 'full'
            ? 'ranked'
            : 'quick'
          : null;
      try {
        await database.insert(rounds).values({
          id: input.id,
          createdByActorId: input.createdByActorId,
          resolution: input.resolution,
          competitionType: input.competitionType,
          length: input.length,
          formatId: input.formatId,
          formatVersion: input.formatVersion,
          presetVersion: input.presetVersion,
          rulesSnapshot: input.rules,
          status: 'scheduled',
          ladderId: ladder,
        });
      } catch (error) {
        if (isUniqueViolation(error))
          throw createAppError('CONFLICT', 'The round already exists', error);
        throw error;
      }
    });
  },

  /** The hydration view: durable truth for one round, in one read. */
  async getRound(id: string): Promise<RoundHydration | null> {
    return instrumented(eventSink, 'getRound', async () => {
      const [row] = await database
        .select()
        .from(rounds)
        .where(eq(rounds.id, id))
        .limit(1);
      if (!row) return null;
      const participants = await database
        .select({
          id: roundParticipants.id,
          actorId: roundParticipants.actorId,
          role: roundParticipants.role,
          slot: roundParticipants.slot,
        })
        .from(roundParticipants)
        .where(eq(roundParticipants.roundId, id));
      const segments = await database
        .select({
          id: roundSegments.id,
          sequence: roundSegments.sequence,
          type: roundSegments.type,
          rulesSegmentKey: roundSegments.rulesSegmentKey,
          startedAt: roundSegments.startedAt,
          endedAt: roundSegments.endedAt,
          durationMs: roundSegments.durationMs,
        })
        .from(roundSegments)
        .where(eq(roundSegments.roundId, id));
      return {
        id: row.id,
        formatId: row.formatId,
        formatVersion: row.formatVersion,
        resolution: row.resolution,
        status: row.status,
        currentStage: row.currentStage,
        startedAt: row.startedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        outcome: row.outcome,
        rules: row.rulesSnapshot as RoundHydration['rules'],
        checkpoint: row.runtimeState as RoundHydration['checkpoint'],
        version: row.version,
        participants,
        segments: segments.map((segment) => ({
          ...segment,
          startedAt: segment.startedAt.toISOString(),
          endedAt: segment.endedAt?.toISOString() ?? null,
        })),
      };
    });
  },

  /**
   * Records the judge's ballot *and* completes the round in one transaction.
   *
   * These were two commits. The ballot landed first and the completion second,
   * and the completion is the one that can lose: it is guarded by the round's
   * optimistic version, so a round that moved under a concurrent write refused
   * with CONFLICT — leaving the ballot on file and the round still `active`.
   * The retry then read the stored ballot and returned it, so the completion
   * was never attempted again and the round stayed `active` and
   * `awaitingBallot` for good. One transaction means the ballot is on file
   * exactly when the round is completed, or neither.
   *
   * The round row is locked before the ballot is read, so the version check and
   * both writes see one consistent state.
   */
  async applyRoundCompletion(
    input: {
      readonly roundId: string;
      readonly expectedVersion: number;
      readonly ballot: {
        readonly ballotId: string;
        readonly judgeParticipantId: string;
        readonly ballot: Ballot;
      };
    } & RoundExecutionWrite,
  ): Promise<void> {
    await instrumented(eventSink, 'applyRoundCompletion', async () => {
      const parsed = ballotSchema.parse(input.ballot.ballot);
      await database.transaction(async (tx) => {
        const [round] = await tx
          .select({ version: rounds.version })
          .from(rounds)
          .where(eq(rounds.id, input.roundId))
          .for('update');
        if (!round) throw createAppError('NOT_FOUND', 'No such round');
        if (round.version !== input.expectedVersion)
          throw createAppError('CONFLICT', 'The round moved on');
        const [seat] = await tx
          .select({ role: roundParticipants.role })
          .from(roundParticipants)
          .where(eq(roundParticipants.id, input.ballot.judgeParticipantId))
          .for('share');
        if (!seat) throw createAppError('NOT_FOUND', 'No such seat');
        if (seat.role !== 'judge')
          throw createAppError('INVARIANT', 'Only a judge seat holds a ballot');
        await tx.insert(ballots).values({
          id: input.ballot.ballotId,
          judgeParticipantId: input.ballot.judgeParticipantId,
          rubricVersion: parsed.rubricVersion,
          winner: parsed.winner,
          scores: parsed.scores,
          reason: parsed.reason,
          feedback: parsed.feedback,
          citations: parsed.citations ?? null,
          status: 'submitted',
          submittedAt: sql`statement_timestamp()` as unknown as Date,
        });
        await writeProjection(tx, input.roundId, input.projection);
        if (input.command !== null) {
          await tx.insert(roundCommands).values({
            commandId: input.command.commandId,
            roundId: input.roundId,
            actorId: input.command.actorId,
            serviceId: input.command.serviceId,
            type: input.command.type,
            payloadDigest: input.command.payloadDigest,
            result: input.command.result,
            resultingVersion: round.version + 1,
            appliedAt: sql`statement_timestamp()` as unknown as Date,
          });
        }
      });
    });
  },

  /**
   * Persists one execution: the command row (idempotency — a replayed
   * command id refuses with its stored result), the projection's segment
   * writes, and the round-row columns, guarded by the round's optimistic
   * version so a round that moved under a concurrent command refuses with
   * CONFLICT and writes nothing.
   */
  async applyRoundExecution(
    input: {
      readonly roundId: string;
      readonly expectedVersion: number;
    } & RoundExecutionWrite,
  ): Promise<void> {
    await instrumented(eventSink, 'applyRoundExecution', async () => {
      await database.transaction(async (tx) => {
        if (input.command !== null) {
          const [existing] = await tx
            .select({ commandId: roundCommands.commandId })
            .from(roundCommands)
            .where(eq(roundCommands.commandId, input.command.commandId))
            .limit(1);
          if (existing)
            throw createAppError('CONFLICT', 'The command was already applied');
        }
        const [round] = await tx
          .select({ version: rounds.version })
          .from(rounds)
          .where(eq(rounds.id, input.roundId))
          .for('update');
        if (!round) throw createAppError('NOT_FOUND', 'No such round');
        if (round.version !== input.expectedVersion)
          throw createAppError('CONFLICT', 'The round moved on');
        await writeProjection(tx, input.roundId, input.projection);
        if (input.command !== null) {
          await tx.insert(roundCommands).values({
            commandId: input.command.commandId,
            roundId: input.roundId,
            actorId: input.command.actorId,
            serviceId: input.command.serviceId,
            type: input.command.type,
            payloadDigest: input.command.payloadDigest,
            result: input.command.result,
            resultingVersion: round.version + 1,
            appliedAt: sql`statement_timestamp()` as unknown as Date,
          });
        }
      });
    });
  },
});
