import type { Ballot, RoundProjection, RoundRules } from '@daisy/protocol';
import { eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { ballotSchema } from '@daisy/protocol';
import { ballotRowOf } from './ballot-row';
import type { z } from 'zod';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { hydrateRound, type RoundHydration } from './round-hydration';
import {
  insertCommandRow,
  lockedRoundVersion,
  writeProjectionWithPhaseSignal,
} from './round-projection-writer';
import { isUniqueViolation } from './unique-violation';
import { roundParticipants } from './schema/round-participants';
import { roundCommands } from './schema/round-commands';
import { ballots } from './schema/ballots';
import { rounds } from './schema/rounds';
import { jsonObjectSchema } from './schema/columns';

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
 * The durable instant for a lifecycle column (ADR 0033 §3.2, ISSUE-37)
 * lives with the write that stamps it: `round-projection-writer.ts`.
 */

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
    return instrumented(eventSink, 'getRound', () =>
      hydrateRound(database, id),
    );
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
        const roundVersion = await lockedRoundVersion(
          tx,
          input.roundId,
          input.expectedVersion,
        );
        const [seat] = await tx
          .select({
            role: roundParticipants.role,
            roundId: roundParticipants.roundId,
          })
          .from(roundParticipants)
          .where(eq(roundParticipants.id, input.ballot.judgeParticipantId))
          .for('share');
        if (!seat) throw createAppError('NOT_FOUND', 'No such seat');
        if (seat.role !== 'judge')
          throw createAppError('INVARIANT', 'Only a judge seat holds a ballot');
        if (seat.roundId !== input.roundId)
          throw createAppError(
            'INVARIANT',
            'The judge seat belongs to another round',
          );
        await tx.insert(ballots).values(
          ballotRowOf({
            ballotId: input.ballot.ballotId,
            judgeParticipantId: input.ballot.judgeParticipantId,
            ballot: parsed,
          }),
        );
        await writeProjectionWithPhaseSignal(
          tx,
          input.roundId,
          roundVersion,
          input.projection,
        );
        await insertCommandRow(
          tx,
          input.roundId,
          input.command,
          roundVersion + 1,
        );
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
        const roundVersion = await lockedRoundVersion(
          tx,
          input.roundId,
          input.expectedVersion,
        );
        await writeProjectionWithPhaseSignal(
          tx,
          input.roundId,
          roundVersion,
          input.projection,
        );
        await insertCommandRow(
          tx,
          input.roundId,
          input.command,
          roundVersion + 1,
        );
      });
    });
  },
});
