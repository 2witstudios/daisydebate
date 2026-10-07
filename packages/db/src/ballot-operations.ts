import { ballotSchema, type Ballot } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { ballotRowOf } from './ballot-row';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';
import { ballots } from './schema/ballots';

/**
 * One ballot per judge seat (ADR 0058 §6): the write path decomposes the
 * full contract into columns. The seat's round agreement is structural
 * (the FK names the seat); that the seat IS a judge is the write-path
 * domain invariant no CHECK can express. First ruling wins: a judge seat
 * that submits twice gets the stored ballot back. Audit times are the
 * database clock of the write (ADR 0033 §3.2).
 */
export const ballotOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  async submitBallot(input: {
    readonly ballotId: string;
    readonly judgeParticipantId: string;
    readonly ballot: Ballot;
  }): Promise<{ readonly stored: boolean }> {
    return instrumented(eventSink, 'submitBallot', async () => {
      const parsed = ballotSchema.parse(input.ballot);
      return database.transaction(async (tx) => {
        const [seat] = await tx
          .select({ role: roundParticipants.role })
          .from(roundParticipants)
          .where(eq(roundParticipants.id, input.judgeParticipantId))
          .for('share');
        if (!seat) throw createAppError('NOT_FOUND', 'No such seat');
        if (seat.role !== 'judge')
          throw createAppError('INVARIANT', 'Only a judge seat holds a ballot');
        const inserted = await tx
          .insert(ballots)
          .values(
            ballotRowOf({
              ballotId: input.ballotId,
              judgeParticipantId: input.judgeParticipantId,
              ballot: parsed,
            }),
          )
          .onConflictDoNothing()
          .returning({ id: ballots.id });
        return { stored: inserted.length === 1 };
      });
    });
  },

  /**
   * Retirement is voiding, never deletion: the row stays and records who
   * and when, tied to the status by CHECK.
   */
  async voidBallot(input: {
    readonly judgeParticipantId: string;
    readonly voidedByActorId: string;
  }): Promise<{ readonly voided: boolean }> {
    return instrumented(eventSink, 'voidBallot', async () => {
      return database.transaction(async (tx) => {
        const [seat] = await tx
          .select({ roundId: roundParticipants.roundId })
          .from(roundParticipants)
          .where(eq(roundParticipants.id, input.judgeParticipantId));
        if (!seat) throw createAppError('NOT_FOUND', 'No such seat');
        await tx
          .select({ id: rounds.id })
          .from(rounds)
          .where(eq(rounds.id, seat.roundId))
          .for('update');
        const updated = await tx
          .update(ballots)
          .set({
            status: 'voided',
            voidedAt: sql`statement_timestamp()` as unknown as Date,
            voidedByActorId: input.voidedByActorId,
          })
          .where(eq(ballots.judgeParticipantId, input.judgeParticipantId))
          .returning({ id: ballots.id });
        return { voided: updated.length === 1 };
      });
    });
  },

  /** The stored ballot for a judge seat, or null. */
  async getBallot(judgeParticipantId: string) {
    return instrumented(eventSink, 'getBallot', async () => {
      const [row] = await database
        .select()
        .from(ballots)
        .where(eq(ballots.judgeParticipantId, judgeParticipantId))
        .limit(1);
      return row ?? null;
    });
  },
});
