import type {
  DebateRole,
  RoundProjection,
  RoundRules,
  RuntimeCheckpoint,
  SegmentType,
} from '@daisy/protocol';
import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import type { z } from 'zod';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { isUniqueViolation } from './unique-violation';
import { roundParticipants } from './schema/round-participants';
import { roundCommands } from './schema/round-commands';
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
 * The durable instant for a lifecycle column: this transaction's clock when
 * the projection is moving the round into the state that records it, and null
 * when it is not. A projection that merely re-states a lifecycle the round
 * already holds leaves the timestamp it already has.
 */
function lifecycleInstant(
  projected: string | null,
  transition: boolean,
): Date | ReturnType<typeof sql> | null {
  if (projected === null) return null;
  return transition
    ? (sql`statement_timestamp()` as unknown as Date)
    : new Date(projected);
}

/** Writes one projection's round row and segment changes inside `tx`. */
async function writeProjection(
  tx: Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0],
  roundId: string,
  projection: RoundProjection,
): Promise<void> {
  if (projection.round !== null) {
    await tx
      .update(rounds)
      .set({
        status: projection.round.status,
        currentStage: projection.round.currentStage,
        // The durable lifecycle instants are PostgreSQL's, never the
        // projection's (ADR 0033 §3.2, ISSUE-37): the timetable and the
        // rating window read these columns, so no caller may choose them.
        // The runtime is still pure — it receives `now` from `databaseNow()`,
        // the same clock — so segment instants agree with these to within the
        // request's latency rather than drifting onto a second clock.
        startedAt: lifecycleInstant(
          projection.round.startedAt,
          projection.round.status === 'active',
        ),
        completedAt: lifecycleInstant(
          projection.round.completedAt,
          projection.round.status === 'completed',
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
